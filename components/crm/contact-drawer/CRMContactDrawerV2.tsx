'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useConfigurationDialogOpen } from '@/components/business-os/ConfigurationDialogProvider';
import { NoShowConfirmDialog } from '@/components/scheduling/NoShowConfirmDialog';
import { businessCollectsIntake, intakeAppliesToService } from '@/lib/business-os/intakeReach';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertCircle,
  User, FolderOpen, Trash2, UserX, UserCheck, Check, Calendar, X, Upload, File, FileText, MessageSquare, Receipt, EyeOff
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SchedulingBookingModal } from '@/components/scheduling/SchedulingBookingModal';
import { jobCalledOff } from '@/lib/business-os/bookingStatus';
import { createLogger } from '@/lib/logger';
/* The BROWSER client, for uploading a file straight to Storage on a signed
   URL — see `handleFileUpload`. Anon key, RLS respected; the permission comes
   from the one-time token, not from this client. */
import { supabase } from '@/lib/supabaseClient';
import {
  ATTACHABLE_ACCEPT,
  ATTACHABLE_DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_MB,
} from '@/lib/crm/attachableDocumentTypes';
import { fetchContactMoney } from '@/lib/payments/fetchContactMoney';
import { transactionMoneyArrived } from '@/lib/payments/bookingPaymentState';
import type { EmailSendStatus } from '@/lib/business-os/emailSendStatus';
import type { SchedulingService, SchedulingBooking } from '@/lib/repositories/SchedulingRepository';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { toast } from 'sonner';

// Import modular sections
import { ClientDetailsSection } from './ClientDetailsSection';
import type { ContactSourceMetadata } from '@/components/crm/contactSources';
import { isContactInactive } from '@/components/crm/contactStatus';
import type { WeeklyAvailability } from '@/components/scheduling/AvailabilityEditor';
import { NotesSection } from './NotesSection';
import { SessionsSection } from './SessionsSection';
import { TasksSection } from './TasksSection';
import { ActivitySection } from './ActivitySection';
import { FilesTab } from './FilesTab';
import { BookingsTab } from './BookingsTab';
import { FormSubmissionsSection } from './FormSubmissionsSection';
import { PaymentManagementModal } from './PaymentManagementModal';
import { ProposalBuilderModal } from './ProposalBuilderModal';
import { quoteGate, quoteWaitingOn } from '@/lib/business-os/quoteGate';
import { StopQuoteDialog } from './StopQuoteDialog';
import {
  OWNER_CANCEL_REASONS,
  cancelReasonKey,
  type OwnerCancelReason,
} from '@/lib/business-os/cancellationReasons';
import { PaymentsSection } from './PaymentsSection';
import { ConsentSection } from './ConsentSection';
import { InvoiceModal } from '@/components/payments/InvoiceModal';
import { RefundModal } from '@/components/payments/RefundModal';
// The same switch the refund and stop-plan dialogs use, so one kind of choice
// has one kind of control across the drawer.
import { CancelMeetingDialog } from '@/components/scheduling/CancelMeetingDialog';
import { translated } from '@/lib/business-os/translateOptional';
import { SwitchRow } from '@/components/payments/SwitchRow';

import { packageSessionPayment } from '@/lib/payments/packageSessionPayment';
import { toBusinessLocalInput } from '@/lib/scheduling/businessTime';
import { nextInSeries } from '@/lib/scheduling/recurrence';
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
  Appointment,
  MeetingAttempt
} from './types';
// The same split Stripe's prices are built from, so what the card shows for a
// period is the figure actually charged. Both are pure functions — no server
// imports — so they are safe in a client component.
import { planPhases } from '@/lib/payments/planSchedule';
import { fromMinorUnits } from '@/lib/payments/refundMath';

// Extended booking data that includes confirmation email info
export interface ExtendedBookingData {
  booking: Appointment;
  payment: SessionPayment | null;
  /**
   * The message telling the client the booking is off.
   *
   * Its own field rather than one of the attempt's emails: a cancellation is
   * about the JOB, and filing it under whichever appointment happened to be
   * current put "the booking is cancelled" inside the meeting's history
   * directly beneath "you cancelled the meeting".
   */
  cancellationEmail?: {
    id: string;
    subject: string;
    status: EmailSendStatus;
    sentAt?: string | null;
  } | null;
  confirmationEmail?: {
    /*
     * The shared roster, not a hand-written copy of it.
     *
     * This literal union omitted `'complained'`, and `types.ts` had already been
     * corrected to `EmailSendStatus` for exactly that reason — so the fix landed
     * on `BookingConfirmationEmail` while THIS declaration, the one
     * `buildJourneySteps` actually reads, kept the old list. The comment there
     * says the compiler could not object to treating a spam complaint as a
     * completed step; it could not object because of this line.
     *
     * Naming the roster means the next status added to `EMAIL_SEND_STATUSES`
     * reaches here on its own, instead of waiting to be noticed twice.
     */
    status: EmailSendStatus;
    sentAt?: string;
    /**
     * Accepted by the recipient's mail server.
     *
     * Carried alongside `openedAt`, which was already here, because the two
     * answer the same question at different depths: did it arrive, and did they
     * look at it. The provider webhook records BOTH as timestamps and leaves
     * `status` at `'sent'`, so a card reading `status` alone can never report
     * either — which is why the confirmation step said nothing about delivery
     * for as long as this field was missing.
     */
    deliveredAt?: string;
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
  status: 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired' | 'withdrawn' | 'superseded' | 'stopped';
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
  /** Why an accepted job was stopped part-way, and the owner's own sentence. */
  stop_reason: string | null;
  stop_note: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  decided_at: string | null;
  created_at: string;
  /** The request this quote answers. Null for rows predating the link. */
  booking_id: string | null;
  /** Days to pay agreed on this version. Null inherits the business default. */
  payment_terms_days: number | null;
  /**
   * The meetings this version sold, for a package.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * CARRIED SO A REVISION STAYS A PACKAGE.
   *
   * Without it a revision of "six sessions, billed after each" opened as a
   * six-STAGE job: the dialog inherits `payment_shape`, which for a
   * per-session package is `milestones` with the stages labelled "Meeting
   * 1"…"Meeting 6", and with no `sessions` to tell it otherwise it drew them as
   * phases of work and the six dates were gone.
   * ───────────────────────────────────────────────────────────────────────────
   */
  sessions: {
    dates: string[];
    duration_minutes: number;
    bill_per_session?: boolean;
  } | null;
  /** The purchase this accepted quote created, for a package. */
  package_booking_id: string | null;
  /** The proposal document sent with THIS version, when there was one. */
  document: { name: string; size: number | null } | null;
  created_invoice_id: string | null;
  /** The invoice acceptance raised, when this quote has been accepted. */
  invoice: {
    status: string;
    amount: number;
    currency: string;
    due_date: string | null;
    /* Derived by trigger from the `payment_refunds` ledger. Carried for a quote
       billed in one go, which has no stages to sum the refund from. */
    refunded_amount: number | null;
    refunded_at: string | null;
  } | null;
  /** Every stage of the agreed plan. Empty for a single payment. */
  stages: Array<{
    id: string;
    /**
     * The SESSION this stage bills, for a package billed per meeting.
     *
     * Six stages of a package share the container's `booking_id`, so that
     * column can no longer say which session a stage belongs to. Null on every
     * ordinary stage, which bills a job rather than one hour.
     */
    meeting_id: string | null;
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
    /**
     * Money returned against THIS stage's invoice.
     *
     * Derived by trigger from the `payment_refunds` ledger and flattened onto
     * the stage by the proposals route, because a refund belongs to the
     * milestone whose money came back — not to the job. Two paid milestones can
     * be refunded independently, and only the stage knows which.
     */
    refunded_amount: number | null;
    refund_status: string | null;
    refunded_at: string | null;
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
/*
 * Exported for its test. Every figure a quoted job shows — the status pill, the
 * refund chip, the totals strip, and through `moneyStateFrom` the card's whole
 * next-step banner — is read off this one return value, so it is worth testing
 * as behaviour rather than pinning its source.
 */
export function quotedPayment(
  proposal: DrawerProposal | null,
  currency: string
): SessionPayment | null {
  /*
   * ACCEPTED OR STOPPED. It used to be accepted alone.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Stopping a job rewrites the proposal to 'stopped', and this returned null
   * for it — so the payment step VANISHED from the card the moment the owner
   * stopped the work. On a job paid in full that erased ₪9,000 of collected
   * money, both receipts and the whole stage history from the one screen that
   * holds a client's record.
   *
   * Stopping ends the work. It does not unmake the money: what was collected
   * was still collected, and it is precisely then that an owner needs to see
   * it, because the next decision is whether any of it goes back.
   *
   * Nothing else needs a stopped case. The figures below are read from the
   * stages, which keep their own statuses, and a stage already paid stays paid.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const answered = proposal?.status === 'accepted' || proposal?.status === 'stopped';

  if (!proposal || !answered || !proposal.invoice) return null;

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

  /*
   * ── MONEY THAT CAME BACK IS STILL MONEY THAT ARRIVED ────────────────────
   *
   * This asked `status === 'paid'`, and a fully refunded invoice's status is
   * `refunded`. So a quote that was paid and then returned read as a quote
   * nobody had ever paid, and ONE false answer here produced every wrong
   * figure on the card at once:
   *
   *   · `collected` fell to 0, so `fullyRefunded` could not be true —
   *     `collected > 0` is one of its clauses — and an $80 refund of an $80
   *     invoice was labelled PARTIALLY refunded
   *   · `status` fell through both branches to 'pending', so Manage payment
   *     showed "Pending" over an $80 refund and offered "Mark as Paid"
   *   · `moneyStateFrom` saw a pending single payment and said
   *     `needs_invoice`, so the card asked the owner to collect payment for
   *     a job whose money had already been collected and given back
   *
   * `outstandingInvoiceId` below was fixed for exactly this — "a refunded
   * invoice is not an outstanding one" — and this line was left behind, which
   * is why the card could know the invoice was not owed and still call the
   * payment pending.
   *
   * Reading `refunded_amount` and not just the status, for the reason that
   * fix gives: a refund can land on an invoice that was never marked paid,
   * leaving `status` at `sent` while the money has genuinely gone back. A
   * PARTIAL refund leaves the status at `paid` and is caught by the first
   * clause either way.
   */
  const anyMoneyCollected =
    paidStages.length > 0 ||
    (stages.length === 0 &&
      (proposal.invoice.status === 'paid' ||
        Number(proposal.invoice.refunded_amount ?? 0) > 0));

  /*
   * WHAT CAME BACK, across the whole job.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Summed from the stages, because each milestone raises its own invoice and a
   * refund attaches to whichever one was paid. Two paid stages can be refunded
   * independently, and only the stage knows which money came back — so the job
   * figure is a sum of stage figures, never a reading of one invoice.
   *
   * This object carried no refund fields at all, and every refund surface in
   * the drawer reads exactly them: the chip, the charged/returned/kept ledger,
   * and the strip's returned and kept cells. A refunded quote therefore looked
   * untouched on the booking card while the payments list showed it correctly.
   *
   * Falls back to the proposal's own invoice for a quote billed in one go,
   * which has no stages to sum.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const refundedAmount = stages.length
    ? stages.reduce((sum, s) => sum + Number(s.refunded_amount || 0), 0)
    : Number(proposal.invoice.refunded_amount || 0);

  /* The most recent one: a job refunded in two goes has two dates, and the
     summary line can only carry the latest. The stage rows carry their own. */
  const refundedAt = stages
    .map(s => s.refunded_at)
    .filter((at): at is string => Boolean(at))
    .sort()
    .pop() ?? proposal.invoice.refunded_at ?? undefined;

  /*
   * `collected` is what the stages actually took, so "everything came back" is
   * a comparison against that and not against the agreement. A ₪7,000 job with
   * one ₪2,000 stage paid and refunded is fully refunded — there is no other
   * money to return.
   */
  const collected = stages.length
    ? paidStages.reduce((sum, s) => sum + Number(s.amount || 0), 0)
    : anyMoneyCollected
      ? proposal.invoice.amount
      : 0;

  const fullyRefunded = refundedAmount > 0 && collected > 0 && refundedAmount >= collected;

  return {
    amount: subject ? Number(subject.amount) : proposal.invoice.amount,
    currency,
    /*
     * `refunded` only when ALL of it went back. A partial refund leaves the
     * status at `paid` and is carried by `refundedAmount` — the same rule
     * `SessionPayment.refundedAmount` documents, and the reason that field
     * exists separately from the status at all.
     */
    status: fullyRefunded ? 'refunded' : anyMoneyCollected ? 'paid' : 'pending',
    refundedAmount: refundedAmount > 0 ? refundedAmount : undefined,
    refundedAt,
    // The invoice behind the payment being DESCRIBED, so a refund finds that
    // transaction rather than the deposit's by default.
    // `invoice_id` reading in, `invoiceId` going out: the stage rows are database
    // shape, the object returned here is the component's.
    invoiceId: subject?.invoice_id ?? proposal.created_invoice_id ?? undefined,
    /*
     * And the STATE of that invoice, which this object never carried.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * The booking-built payment above sets `invoiceStatus`; this one did not,
     * so for a QUOTED job the field was always undefined and every reader that
     * asks whether the invoice is still live silently got "no idea".
     *
     * What that cost: a quote stopped before payment, its invoice voided both
     * here and at Stripe, went on showing "outstanding ₪5,000" with a Manage
     * payment button and an offer to resend the invoice that had just been
     * cancelled. The card could not see the cancellation because nothing put it
     * in front of the card.
     *
     * Only for a quote with no stages. A staged quote's money is read from the
     * stages, which carry their own statuses and are already set to `cancelled`
     * when a job is stopped; naming the quote's own invoice there would
     * describe the wrong thing.
     * ─────────────────────────────────────────────────────────────────────────
     */
    invoiceStatus: stages.length
      ? undefined
      : (proposal.invoice.status as SessionPayment['invoiceStatus']),
    /*
     * What is owed right now: the earliest unpaid stage that has actually been
     * billed. A milestone nobody has marked done has no invoice to resend, and
     * offering to resend one would be offering to send nothing.
     */
    /*
     * ───────────────────────────────────────────────────────────────────────
     * A REFUNDED INVOICE IS NOT AN OUTSTANDING ONE.
     *
     * The fallback asked "is this invoice not `paid`", and a refunded invoice's
     * status is `refunded` — which is not `paid`, so money that had been
     * collected and handed back read as money still to collect. Downstream,
     * `PaymentManagementModal` turns that into a settleable invoice and offers
     * "Mark as paid" on a job the owner had just refunded.
     *
     * `refunded_amount` rather than `status`, and the repo's own
     * `hasBeenRefunded` says why with a live row: a refund can land on an
     * invoice that was never marked paid, leaving `status` reading `sent` while
     * the money has genuinely gone back. A PARTIAL refund also deliberately
     * leaves the status at `paid`, and that invoice is no more collectable for
     * it.
     *
     * The first clause is untouched on purpose: a stage that is genuinely
     * unpaid and has been billed IS outstanding, which is what keeps the
     * record-payment button alive on a job whose deposit was refunded while its
     * final milestone is still owed.
     * ───────────────────────────────────────────────────────────────────────
     */
    outstandingInvoiceId:
      stages.find(s => s.status !== 'paid' && s.invoice_id)?.invoice_id ??
      (proposal.invoice.status !== 'paid' && Number(proposal.invoice.refunded_amount ?? 0) <= 0
        ? proposal.created_invoice_id ?? undefined
        : undefined),
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
            /* Which SESSION of a package this stage bills, when it bills one. */
            meetingId: s.meeting_id ?? null,
            label: s.label,
            amount: Number(s.amount),
            status: s.status,
            trigger: s.trigger,
            invoiceId: s.invoice_id,
            dueDate: s.due_date,
            paidAt: s.paid_at,
            refundedAmount: s.refunded_amount ?? null,
            refundedAt: s.refunded_at ?? null,
          })),
        }
      : undefined,
  };
}

/** The offer that stands — the newest that has not been replaced. */
/**
 * A package's meetings, folded into the journey that sold them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE AGREEMENT IS ONE JOURNEY, AND THE JOURNEY IS THE QUOTE'S.
 *
 * Flat, an accepted six-session package produced seven cards. Grouping the
 * meetings under their container left two: the consultation where the quote was
 * agreed, and the container — which carries no quote of its own, so it drew a
 * SECOND journey asking for one. "Waiting for a quote", on the thing a quote
 * had just created.
 *
 * So the meetings travel one step further: to the booking the quote came out
 * of, where the client's journey already is. They arrive as a STAGE in that
 * journey — "the meetings" — listed under it, each with its own date, status
 * and actions, because each is a real appointment that can be held, missed,
 * moved or called off alone.
 *
 * Two fallbacks, both deliberate:
 *   · a quote sold COLD has no booking to attach to, so its container stays as
 *     the card. It is the only row representing that purchase.
 *   · a meeting whose container is missing from the list stays where it is.
 *     That happens mid-refetch, and a vanishing appointment is worse than an
 *     ungrouped one.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/**
 * A package's sessions, read from the ONE booking that now holds them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A package used to be a container plus one child BOOKING per date, so its
 * sessions arrived as cards of their own and only had to be grouped. They are
 * now rows in `scheduling_meetings` on a single booking, and they reach the
 * drawer as that booking's `attempts` — the same payload the journey already
 * uses to draw the times an appointment has had.
 *
 * `session_number` is what separates the two readings of that list. On an
 * ordinary booking the attempts are tries at ONE appointment; here each
 * numbered session is a different appointment, and only the latest attempt at
 * each is the hour the client holds.
 *
 * WHAT THESE ROWS ARE
 *
 * View models, not database rows. Each one borrows the purchase — the client,
 * the service, the status — and puts its own clock in, because that is the
 * only thing that differs between six sessions of one package.
 *
 * `parent_booking_id` is set to the container deliberately, and no such value
 * exists in the database any more. Every client-side reader that asks "is this
 * a session rather than a purchase" already asks that question this way:
 * `isQuotedJob`, `sessionNextStep`, the card grouping. Setting it keeps all of
 * them correct without touching one of them.
 *
 * `meeting_id` is what tells an ACTION apart. A session's outcome is recorded
 * against the meeting, not a booking, so a handler must send it to
 * `/api/scheduling/meetings/[id]/outcome` rather than the booking route.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function sessionCardsFromMeetings(
  card: SessionCardData,
  proposals: DrawerProposal[]
): SessionCardData[] {
  const numbered = (card.booking.attempts ?? []).filter(
    attempt => attempt.session_number !== null && attempt.session_number !== undefined
  );

  if (numbered.length === 0) return [];

  /*
   * ── WHICH SESSIONS HAVE ALREADY BEEN MADE UP ────────────────────────────
   *
   * Read the other way round from how it is written: a replacement names the
   * session it stands in for, so a session is "replaced" when something points
   * AT it. One pass over the attempts, rather than a lookup per row.
   *
   * This is the fact the card could not previously get at. Inferring it from
   * the block's size worked only while there was exactly one gap: on a package
   * with two missed sessions, one made up and one waiting on the client, no
   * count can tell them apart — see 20261097.
   */
  const replaced = new Set(
    (card.booking.attempts ?? [])
      .map(attempt => attempt.replaces_meeting_id)
      .filter((id): id is string => typeof id === 'string' && Boolean(id))
  );

  /*
   * The CURRENT attempt at each session: the highest `occurrence_number`.
   *
   * `moved` is skipped rather than ranked. A superseded attempt is an hour the
   * client gave back — listing it would show a date nobody holds, and showing
   * it as the session's state would contradict the attempt that replaced it.
   */
  const current = new Map<number, MeetingAttempt>();

  for (const attempt of numbered) {
    if (attempt.meeting_status === 'moved') continue;

    const session = Number(attempt.session_number);
    const seen = current.get(session);

    if (!seen || Number(attempt.occurrence_number ?? 1) > Number(seen.occurrence_number ?? 1)) {
      current.set(session, attempt);
    }
  }

  /* The stages of the quote that sold this package, by the session each bills. */
  type DrawerStage = DrawerProposal['stages'][number];
  const stageByMeeting = new Map<string, DrawerStage>();

  for (const proposal of proposals) {
    if (proposal.package_booking_id !== card.booking.id) continue;
    for (const stage of proposal.stages ?? []) {
      if (stage.meeting_id) stageByMeeting.set(stage.meeting_id, stage);
    }
  }

  return [...current.entries()]
    .sort(([a], [b]) => a - b)
    .map(([session, attempt]) => {
      const stage = stageByMeeting.get(attempt.id);

      return {
        booking: {
          ...card.booking,
          id: attempt.id,
          meeting_id: attempt.id,
          parent_booking_id: card.booking.id,
          start_time: attempt.start_time,
          end_time: attempt.end_time,
          meeting_status: attempt.meeting_status,
          /*
           * Already made up: something was booked in its place. The row then
           * does not offer to move it — the hour has been arranged once
           * already, and moving it would leave the client holding two.
           */
          was_replaced: replaced.has(attempt.id),
          /* And who said so — without it the table cannot tell a session the
             owner confirmed from one the automation closed off. */
          outcome_by: attempt.outcome_by ?? null,
          /*
           * ─────────────────────────────────────────────────────────────────
           * THE SESSION'S OWN STATE, NOT THE PURCHASE'S.
           *
           * This borrowed the container's `status`, which is `confirmed` for
           * the whole life of a running package — so a session the owner had
           * just called off went on reading "מאושרת", confirmed, next to its
           * own struck-through date. Two parts of one row saying opposite
           * things about the same hour.
           *
           * The purchase is still confirmed, and that is right: calling off an
           * hour does not cancel the package. It is simply not this row's
           * answer. A row stands for a session, so it says what happened to
           * the session, and falls back to the job only while nothing has.
           * ─────────────────────────────────────────────────────────────────
           */
          status:
            attempt.meeting_status === 'cancelled'
              ? 'cancelled'
              : attempt.meeting_status === 'no_show'
                ? 'no_show'
                : attempt.meeting_status === 'held'
                  ? 'completed'
                  : card.booking.status,
          /* The SESSION's number, which is what the row is labelled with. */
          occurrence_number: session,
          /*
           * Not the purchase's whole list. A session's own history is the
           * attempts that share its number, which is what the journey under it
           * should show rather than every attempt at every session.
           */
          attempts: numbered.filter(a => Number(a.session_number) === session),
        },
        /*
         * This session's money is its STAGE. An invoice raised for it now
         * carries the container's `booking_id`, so the booking-keyed payment
         * the card was built from describes the purchase, not this hour.
         */
        /*
         * A voided stage is not money owing. Its session was called off, it
         * will never bill, and showing "133.33 · pending" beside a row that
         * says בוטלה claims an amount nobody can collect.
         */
        payment: stage && stage.status !== 'cancelled'
          ? ({
              id: stage.id,
              amount: Number(stage.amount),
              currency: String(stage.currency ?? card.payment?.currency ?? 'ILS'),
              /*
               * ───────────────────────────────────────────────────────────
               * A PART OF IT CAME BACK IS NOT ALL OF IT CAME BACK.
               *
               * Any refund at all read as `refunded`, so a session paid
               * 133.33 with 66.67 returned said the whole thing had gone
               * back — and the row stopped offering Refund for the half
               * still held, because that gate asks for `paid`.
               *
               * Only a refund that covers the amount settles it. Anything
               * less leaves the stage paid, with what went back carried
               * beside it.
               * ───────────────────────────────────────────────────────────
               */
              status:
                Number(stage.refunded_amount ?? 0) >= Number(stage.amount ?? 0) &&
                Number(stage.amount ?? 0) > 0
                  ? 'refunded'
                  : stage.status === 'paid'
                    ? 'paid'
                    : 'pending',
              invoiceId: stage.invoice_id ?? undefined,
              paidAt: stage.paid_at ?? undefined,
              refundedAt: stage.refunded_at ?? undefined,
              refundedAmount: stage.refunded_amount ?? undefined,
            } as SessionPayment)
          : null,
      };
    });
}

function foldPackageMeetings(
  cards: SessionCardData[],
  proposals: DrawerProposal[] = []
): SessionCardData[] {
  const byId = new Map(cards.map(card => [card.booking.id, card]));

  const meetingsByParent = new Map<string, SessionCardData[]>();

  for (const card of cards) {
    const parent = card.booking.parent_booking_id;
    if (!parent || !byId.has(parent)) continue;

    const siblings = meetingsByParent.get(parent) ?? [];
    siblings.push(card);
    meetingsByParent.set(parent, siblings);
  }

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE NEW SHAPE, WHERE THERE ARE NO CHILD CARDS TO GROUP.
   *
   * A package written since the change has its sessions on the container
   * itself, so the loop above finds nothing. Added to the same map rather than
   * handled apart, so everything below — finding the quote that sold it,
   * absorbing the container into that booking's journey, the package step —
   * works on both shapes without knowing which it has.
   *
   * Both are read, never one or the other: a package sold last month is still
   * child bookings, and a client can pay for it today.
   * ───────────────────────────────────────────────────────────────────────────
   */
  for (const card of cards) {
    if (meetingsByParent.has(card.booking.id)) continue;

    const sessions = sessionCardsFromMeetings(card, proposals);
    if (sessions.length > 0) meetingsByParent.set(card.booking.id, sessions);
  }

  if (meetingsByParent.size === 0) return cards;

  /*
   * Where each container's meetings should end up: the booking its quote came
   * out of, when that booking is on screen — otherwise the container itself.
   */
  const hostOf = new Map<string, string>();

  for (const containerId of meetingsByParent.keys()) {
    const sold = proposals.find(proposal => proposal.package_booking_id === containerId);
    const host = sold?.booking_id && byId.has(sold.booking_id) ? sold.booking_id : containerId;
    hostOf.set(containerId, host);
  }

  const absorbed = new Set(
    [...hostOf.entries()].filter(([container, host]) => container !== host).map(([container]) => container)
  );

  return cards
    // The meetings themselves, and any container whose journey has a better home.
    .filter(card => !meetingsByParent.has(card.booking.id) || !absorbed.has(card.booking.id))
    .filter(card => !card.booking.parent_booking_id || !byId.has(card.booking.parent_booking_id))
    .map(card => {
      const containerId = [...hostOf.entries()].find(([, host]) => host === card.booking.id)?.[0];
      const meetings = containerId ? meetingsByParent.get(containerId) : undefined;
      if (!meetings?.length) return card;

      // In the order they were sold, which is the order the client agreed to.
      const ordered = [...meetings].sort(
        (a, b) => (a.booking.occurrence_number ?? 0) - (b.booking.occurrence_number ?? 0)
      );

      /*
       * A STAGE in the journey, not a panel beside it. The meetings are what
       * the agreement produced, so they belong on the same timeline as the
       * quote that produced them — after it, which is when they happen.
       */
      /*
       * The next meeting STILL TO HAPPEN, which is the first one nobody has
       * said anything about yet.
       *
       * This asked for `status === 'confirmed'`, and that stopped meaning
       * "not yet held" when `complete()` moved the outcome to
       * `meeting_status`: a package meeting marked held keeps
       * `status: 'confirmed'`, so the search returned a meeting that had
       * already taken place. "Next up" pointed backwards, and the package step
       * never left `active` — a package of six read as still running after all
       * six were done.
       */
      const nextUp = ordered.find(
        meeting =>
          meeting.booking.meeting_status == null &&
          (meeting.booking.status === 'confirmed' || meeting.booking.status === 'pending')
      );

      /*
       * ───────────────────────────────────────────────────────────────────────
       * A PACKAGE THAT WAS CALLED OFF DID NOT COMPLETE.
       *
       * The status was `nextUp ? 'active' : 'completed'`, and nothing else.
       * Cancelling a package answers every one of its sessions, so `nextUp`
       * goes undefined and the step turned GREEN — the same green a block of
       * six that all went ahead gets. The owner stopped the work and the
       * timeline congratulated them on finishing it.
       *
       * `skipped` rather than `failed`: stopping work is a decision, not a
       * fault, and red is the alarm colour this drawer keeps for things that
       * went wrong. Skipped already renders as a faint disc with a dark glyph,
       * which reads as "this did not happen" at a glance.
       *
       * Read off the CONTAINER rather than counted from the sessions. One held
       * session out of thirteen would otherwise still earn a green tick, and a
       * package cancelled before any session happened would look identical to
       * one nobody ever got round to — which are different facts.
       * ───────────────────────────────────────────────────────────────────────
       */
      const packageCalledOff =
        card.booking.status === 'cancelled' || card.booking.meeting_status === 'cancelled';

      const packageStep: BookingJourneyStep = {
        id: `${card.booking.id}-package`,
        key: 'package',
        status: packageCalledOff ? 'skipped' : nextUp ? 'active' : 'completed',
        timestamp: ordered[0]?.booking.start_time ?? undefined,
        /*
         * `packageFull` — an UPFRONT block already at the number of sessions
         * it was sold with, so "Add another meeting" is not offered.
         *
         * A package paid in one sum is a contract for a stated count at a
         * stated total. A session beyond it has no money behind it, and the
         * client's own total stops matching the quote they accepted. Another
         * session means another agreement.
         *
         * THREE THINGS THIS IS DELIBERATELY NARROW ABOUT:
         *
         *   A package billed PER SESSION is never full. Each session is paid
         *   after it is held, so a seventh on a block of six is priced when it
         *   happens and contradicts no agreed total — the scenario the control
         *   itself was written for, and which must keep working.
         *
         *   Only a block with an agreed count can be full. A package with no
         *   proposal behind it has no number to exceed, so it is left alone.
         *
         *   A session called off or MISSED does not hold its place. Both are
         *   cases where the owner may offer another hour, and this decides
         *   whether they can. The money says the other thing on purpose: a
         *   no-show keeps its portion, because it consumed one, so a make-up
         *   after a no-show is free — while a cancelled session's portion
         *   moves to whatever replaces it. Growing the block is refused;
         *   repairing it is not.
         *
         * The route refuses this too, with `package_already_complete`. This
         * only stops offering what it would refuse.
         */
        metadata: {
          count: ordered.length,
          containerId,
          packageFull: (() => {
            const sold = proposals.find(
              proposal => proposal.package_booking_id === containerId
            );

            if (sold?.sessions?.bill_per_session === true) return false;

            const agreed = sold?.sessions?.dates?.length ?? 0;
            if (agreed === 0) return false;

            /* Neither called off nor missed — the same test the add-session
               route makes, so the button and the route cannot disagree. */
            const occupied = (status?: string | null) =>
              status !== 'cancelled' && status !== 'no_show';

            const standing = ordered.filter(
              meeting =>
                occupied(meeting.booking.meeting_status) && occupied(meeting.booking.status)
            ).length;

            return standing >= agreed;
          })(),
        },
      };

      const steps = card.journeySteps ? [...card.journeySteps] : [];
      const afterQuote = steps.findIndex(step => step.key === 'proposal');

      // Straight after the quote where there is one; at the end otherwise.
      if (afterQuote >= 0) steps.splice(afterQuote + 1, 0, packageStep);
      else steps.push(packageStep);

      return { ...card, meetings: ordered, journeySteps: steps };
    });
}

/**
 * Does this booking's journey involve a quote at all?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `sale_mode: 'proposal'` is a fact about the SERVICE, and a package is sold
 * through exactly such a service — so every one of its six meetings answered
 * yes, took the quoting journey, and said "the quote will be sent after the
 * meeting" about a meeting that quote had already created, sold and billed.
 *
 * A session of a package is what a quote PRODUCED. The quote belongs to the
 * purchase it created, which is the container, and the container is the row
 * with no parent.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function isQuotedJob(booking: {
  parent_booking_id?: string | null;
  service?: { sale_mode?: 'direct' | 'proposal' | null } | null;
}): boolean {
  return booking.service?.sale_mode === 'proposal' && !booking.parent_booking_id;
}

function pickProposal(bookingId: string, proposals: DrawerProposal[]): DrawerProposal | null {
  return proposalsFor(bookingId, proposals).find(p => p.status !== 'superseded') ?? null;
}

// Build journey steps based on booking data
// This determines which steps to show and their status for each booking type
/**
 * Is there anything left for "Stop this job" to stop?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The button cancels the UNBILLED phases and marks the work ended. It was gated
 * on `proposalStatus === 'accepted'` alone, and an accepted quote stays accepted
 * for ever — so it sat on a ₪2,000 job with both stages paid and both invoices
 * settled, inviting an owner to press it and discover it does nothing nameable.
 *
 * A stage is still stoppable while `pending` or `billed`: billed-but-unpaid
 * money can be called off, which is most of the point. `paid`, `cancelled` and
 * `refunded` are finished either way.
 *
 * No plan means a single-payment quote, where the payment's own status is the
 * whole answer. Note that `status` here means "has money been collected", not
 * "is the plan finished" — see `quotedPayment`.
 *
 * Exported so it can be tested. It lives on a journey step inside a
 * four-thousand-line component, and the cost of that being unreachable from a
 * test is a button that either never leaves or leaves too early, on a surface
 * that ends someone's job.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const FINISHED_STAGE = ['paid', 'cancelled', 'refunded'];
const SETTLED_PAYMENT = ['paid', 'refunded', 'free'];

/**
 * Was this booking's money recorded by hand rather than taken by a processor?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Answered from the CHARGES, because they are the only rows that know. Money
 * recorded by hand still writes a real `payment_transactions` row — `mark-paid`
 * gives it `processor_type: 'manual'` — so the distinction is a field, not an
 * absence.
 *
 * It asks EVERY settled charge, not the first. A job part-paid in cash and part
 * by card can still be refunded through the processor, so telling the owner the
 * money must be returned by hand would be wrong. That is only true when nothing
 * went through a processor at all.
 *
 * No settled charge means unknown, which is `false`: an unpaid booking must not
 * be labelled as settled by hand.
 */
function isManuallySettled(
  charges: Array<{ status?: string | null; processor_type?: string | null }> | undefined
): boolean {
  const settled = (charges ?? []).filter(c => c.status === 'succeeded');
  return settled.length > 0 && settled.every(c => c.processor_type === 'manual');
}

export function hasStoppableWork(payment: SessionPayment | null | undefined): boolean {
  const stages = payment?.plan?.stages;

  if (stages?.length) {
    return stages.some(stage => !FINISHED_STAGE.includes(String(stage.status)));
  }

  return !SETTLED_PAYMENT.includes(String(payment?.status ?? ''));
}

export function buildJourneySteps(
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
  collectsIntake: boolean = false,
  /**
   * The business's clock. Passed rather than read, because this is a plain
   * function and hooks are not available to it — and defaulted to UTC rather
   * than the browser's zone, matching every other fallback in the fix.
   */
  timezone: string = 'UTC'
): BookingJourneyStep[] {
  const { booking, payment, confirmationEmail } = data;
  const steps: BookingJourneyStep[] = [];
  /*
   * WHAT IT IS, NOT WHETHER A TIMESTAMP TURNED UP.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * This read `!booking.start_time || booking.service?.is_product`, and
   * `scheduling_services.is_product` DOES NOT EXIST — it is declared in this
   * file's local service type and nowhere in the database. So the second half
   * was permanently `undefined` and the whole test collapsed to "has no start
   * time".
   *
   * That is a proxy, and it fails in the direction that hides a problem: a
   * SCHEDULED service whose booking is missing its time is silently reclassified
   * as a product. Its final step becomes "fulfilment" instead of the session,
   * and the journey now says "No appointment" about a sale that is supposed to
   * have one — reassuring the owner about the exact thing that is wrong.
   *
   * `is_scheduled` is the authoritative fact and one of the three the service
   * model is built on. The start-time proxy survives only as a fallback for a
   * row that did not carry it, so nothing regresses where the field is absent.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const isUnscheduled =
    booking.service?.is_scheduled === false ||
    (booking.service?.is_scheduled == null && !booking.start_time);
  const hasIntake = booking.intake_responses && Object.keys(booking.intake_responses.responses || {}).length > 0;
  const bookingDate = booking.start_time ? new Date(booking.start_time) : null;
  const isUpcoming = booking.status === 'confirmed' && bookingDate && bookingDate > new Date();
  /*
   * The appointment's outcome, read from the column it lives in.
   *
   * `complete()` writes `meeting_status: 'held'` and leaves `status` at
   * `confirmed`, so asking `status` alone made every meeting marked held since
   * the split read as still running — which is what decides the intake
   * wording ("not sent YET" versus "never sent") and several step states.
   *
   * `meeting_status == null &&` guards the legacy branch so the two can never
   * both answer: once the column has a value it is the only one consulted.
   */
  const isCompleted =
    booking.meeting_status === 'held' ||
    (booking.meeting_status == null && booking.status === 'completed');
  const isCancelled =
    booking.meeting_status === 'no_show' ||
    booking.meeting_status === 'cancelled' ||
    booking.status === 'cancelled' ||
    (booking.meeting_status == null && booking.status === 'no_show');
  /*
   * A booking that began as a quote request.
   *
   * Read from the service rather than the booking, because a consultation
   * booked on the way to a quote is an ordinary confirmed booking in every
   * other respect — what makes it part of a quoted journey is what is being
   * sold, not how the row was created.
   */
  /*
   * A SESSION OF A PACKAGE IS NOT A JOB AWAITING A QUOTE.
   *
   * The service is still `sale_mode: 'proposal'` — that is how the block was
   * sold — so every one of the six meetings drew the quoting journey and said
   * "the quote will be sent after the meeting", about a meeting the quote had
   * already created, been accepted and billed. The quote belongs to the
   * PURCHASE, which is the container, and these are what it bought.
   */
  const isQuotedBooking = isQuotedJob(booking);

  // Helper to format date and time, on the business's clock — the same one the
  // calendar, the booking dialog and the client's email use.
  const formatDateTime = (date: Date) => date.toLocaleString(language, {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });


  // Helper to format currency
  const formatAmount = (amount: number, currency: string) => {
    return new Intl.NumberFormat(language, { style: 'currency', currency }).format(amount);
  };

  /*
   * Step 1: what was bought. Always a SERVICE.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * This chose between 'product' and 'service', and the platform has no product
   * status: everything sold lives in `scheduling_services`, and the three facts
   * that describe one are `is_scheduled`, `collection` and `sale_mode`. A
   * service you do not book a time for is still a service.
   *
   * So a client who bought a course saw their journey open with "מוצר", a word
   * for a thing this platform does not sell. The distinction that IS real —
   * whether a time was booked — is carried by the final step below, which is
   * the session for a scheduled service and the delivery for one without.
   * ───────────────────────────────────────────────────────────────────────────
   */
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * ONE STEP, BECAUSE ONE THING HAPPENED.
   *
   * This was two: `service`, whose detail was the service name, and `client`,
   * whose detail was "name • email • phone". Both carried `booking.created_at`,
   * so the journey opened with two rows stamped the same minute —
   *
   *     שירות        15:54   הצעת מחיר לשיפוץ
   *     פרטי לקוח    15:54   דויד המלך • offir@… • 2013643030
   *
   * — for the single event of the booking being made. On a rail whose whole
   * job is to show a sequence, two marks for one moment is a sequence that
   * is not true.
   *
   * Both also repeated what was already on screen. The service name is the
   * card's own title, two inches above. The client is the SUBJECT OF THE
   * DRAWER: their name, email and phone are in its header.
   *
   * So: one mark, the client's name, and how the booking arrived — which is
   * the one fact here that appears nowhere else.
   * ───────────────────────────────────────────────────────────────────────────
   */
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

  /*
   * HOW THE BOOKING ARRIVED — the one fact on this row that is nowhere else.
   *
   * Worded here rather than with a translation key because this builder is a
   * plain function with no `t`; it takes `language` and carries its own word
   * maps, which is the pattern the rest of the file already uses. An unknown
   * source says nothing rather than guessing: a new `booking_source` value
   * should read as silence, not as a wrong sentence.
   */
  const ORIGIN_WORDS: Record<string, Record<string, string>> = {
    he: {
      quote_request: 'הלקוח ביקש הצעת מחיר',
      website: 'הלקוח הזמין דרך האתר',
      manual: 'נוצר על ידך',
      proposal: 'נוצר מתוך הצעת מחיר',
    },
    es: {
      quote_request: 'El cliente pidió un presupuesto',
      website: 'Reservó desde la web',
      manual: 'Creada por ti',
      proposal: 'Creada desde un presupuesto',
    },
    en: {
      quote_request: 'The client asked for a quote',
      website: 'Booked from the website',
      manual: 'Created by you',
      proposal: 'Created from a quote',
    },
  };

  const origin = (ORIGIN_WORDS[language] ?? ORIGIN_WORDS.en)[booking.booking_source ?? ''] ?? '';

  /*
   * WHO STARTED IT — and the two are not the same kind of event.
   *
   * "The client asked for a quote" is demand arriving on its own. "Created by
   * you" is the owner entering something they already agreed elsewhere. An
   * owner scanning a list of jobs is looking for the first kind, and in one
   * grey sentence the two are indistinguishable.
   *
   * Carried as metadata rather than baked into the text, because a string
   * cannot be given a colour. The card tints the client's half.
   */
  const originBy: 'client' | 'owner' | null = !booking.booking_source
    ? null
    : booking.booking_source === 'manual' || booking.booking_source === 'proposal'
      ? 'owner'
      : 'client';

  steps.push({
    id: `${booking.id}-booked`,
    key: 'booked',
    status: 'completed',
    /*
     * The NAME only. The origin travels in metadata so the card can mark it;
     * joined in here it would be one unstyleable run.
     *
     * Isolated because it is a strong-direction run inside a line that may be
     * the other direction — without it the separators drift and the line reads
     * as "· name origin".
     */
    details: clientName ? isolate(clientName) : '',
    metadata: { origin, originBy },
    timestamp: booking.created_at,
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
     * When the owner may send the quote — five states, in `quoteGate`.
     *
     * ───────────────────────────────────────────────────────────────────────────
     * This was a boolean: waiting on the meeting, or your move. It flipped on the
     * clock alone, so the moment a consultation's start time passed the journey
     * said the owner owed a price — for a site visit nobody attended, which is
     * simply false and read as an overdue task.
     *
     * The clock is still the trigger rather than the completion flag, for the
     * reason it always was: owners quote from the van and rarely mark an
     * appointment done first. What changed is that the state between "ahead" and
     * "your move" now EXISTS and asks — `unmarked` — instead of assuming.
     *
     * The rules live in `lib/business-os/quoteGate.ts` with their own tests. Five
     * states inside this component is how the first version came to contradict
     * its own comment about no-shows.
     * ───────────────────────────────────────────────────────────────────────────
     */
    const gate = quoteGate({
      bookingStatus: booking.status,
      /*
       * The two the gate could not previously see.
       *
       * `calledOff` because a held consultation whose job was cancelled keeps
       * `status = 'completed'` — so the gate's `'closed'` branch was
       * unreachable for exactly the bookings it mattered for, and the
       * create-quote button survived the cancellation.
       *
       * `meetingStatus` because the appointment's outcome now has a column of
       * its own and no longer has to overwrite the job's.
       */
      calledOff: jobCalledOff(booking),
      meetingStatus: booking.meeting_status ?? null,
      startTime: bookingDate,
      isUnscheduled,
      proposalStatus: proposal?.status ?? null,
    });

    const awaitingMeeting = gate === 'ahead';

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
    /*
     * A STOPPED quote closes the job too, not just a cancelled booking.
     *
     * Without this the step fell through every branch below to `'active'` and
     * `waitingOn: 'client'` — so a job the owner had just stopped read as live and
     * waiting on the client, and the header badge went back to "awaiting a quote".
     * The booking is untouched by stopping a quote (there may be nothing to
     * cancel — a bookingless quote has no appointment), so `isCancelled` alone
     * could never see it.
     *
     * One line covers three things, which is why it belongs here rather than in
     * each branch: the step becomes `failed`, `waitingOn` becomes `closed`, and
     * the "Send a quote" button — gated on `waitingOn === 'owner'` — stops
     * inviting a new price for work that has ended.
     */
    /*
     * `gate` already weighed both: a cancelled booking and a stopped quote.
     *
     * It deliberately does NOT include `no_show`, which `isCancelled` above
     * does — that variable is read by the payment and intake steps, where it
     * means "the job is off", and folding a missed meeting into it took the
     * quote button away from a client who simply did not turn up. The comment
     * below has always said cancelling is the only mark that ends a job; now
     * the code agrees.
     */
    const jobClosed = gate === 'closed';

    /*
     * `unmarked` and `missed` are ACTIVE, not failed.
     *
     * Both need something from the owner — an answer, or a new time — and a
     * failed step offers nothing and invites nothing. Only a cancelled job and
     * a dead quote are failures.
     */
    const status: BookingJourneyStep['status'] = jobClosed
      ? 'failed'
      : !proposal
        ? gate === 'ahead'
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
         * ─────────────────────────────────────────────────────────────────
         * IS THERE ANYTHING LEFT TO STOP?
         *
         * "Stop this job" cancels the UNBILLED phases and marks the work
         * ended. On a quote whose every stage is paid there are no unbilled
         * phases, so the button does nothing it can describe — and offering
         * it on a finished, fully-collected job invites an owner to press it
         * and find out.
         *
         * It was gated on `proposalStatus === 'accepted'` alone, and an
         * accepted quote stays accepted forever. Reported on a ₪2,000 job
         * with both stages paid and both invoices settled.
         *
         * A stage still counts as stoppable while it is `pending` or
         * `billed` — billed but unpaid money can still be called off, which
         * is most of the point. `paid`, `cancelled` and `refunded` are
         * finished either way.
         *
         * No plan means a single-payment quote, where the payment's own
         * status is the whole answer.
         * ─────────────────────────────────────────────────────────────────
         */
        hasStoppableWork: hasStoppableWork(data.payment),
        /*
         * The quote's own title, so a confirmation dialog can name the job
         * instead of showing a uuid. Flattened here like every other field: the
         * step's metadata crosses into a presentational component.
         */
        title: proposal?.title ?? null,
        /*
         * Which side the ball is on — the one fact both the label and the
         * button read, so the strip cannot say "waiting on the meeting" beside
         * a button inviting you to skip it.
         */
        /*
         * Derived by `quoteWaitingOn` from the same state the status above
         * used, so the strip's label and the "Send a quote" button — which is
         * gated on this value — cannot describe different situations.
         */
        waitingOn: quoteWaitingOn(gate, proposal?.status ?? null),
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
          /*
           * Per version too, for the same reason the decline reason is: a job
           * stopped because the client would not pay and one stopped because the
           * business could not finish are different stories, and the strip is
           * where an owner goes back to read them.
           */
          stopReason: v.stop_reason,
          stopNote: v.stop_note,
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

    /*
     * Overdue means the DAY has passed, not the instant.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * This was `new Date(dueDate) < new Date()`, which compares a DATE against
     * an INSTANT and gets both halves wrong:
     *
     *   · `new Date('2026-09-30')` is midnight UTC, so an invoice due on the
     *     30th was already "past" at 00:00 UTC — before the day had started
     *     anywhere west of London.
     *   · An invoice due TODAY is not late. It was reported overdue from the
     *     first second of its own due date, so INV-00013, raised at 14:46 and
     *     payable on receipt, showed as overdue the moment it existed.
     *
     * Compared as calendar days instead. `en-CA` renders `YYYY-MM-DD`, which
     * sorts lexicographically, so no instant arithmetic is involved at all.
     * The owner's own zone is the right one here: this is their screen, and it
     * is the calendar they are looking at.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const todayKey = new Date().toLocaleDateString('en-CA');
    const isOverdue =
      payment.status === 'pending' &&
      Boolean(payment.invoiceDueDate) &&
      String(payment.invoiceDueDate).slice(0, 10) < todayKey;

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
              /*
               * NOT `completed`, which is green.
               *
               * It was mapped there as "transaction done" — true of the
               * transaction, and the wrong thing to say about the job. The node
               * is the first mark an owner reads on the card, and it told them
               * a fully refunded sale had completed.
               */
              payment.status === 'refunded' ? 'refunded' :
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
        /*
         * Nothing to send once money has gone back.
         *
         * The send route refuses a refunded invoice — it would be a bill for
         * money the client was just given, carrying a live pay button — but the
         * button was still drawn, so the owner pressed it and got an error for
         * their trouble. A control that cannot succeed should not be offered.
         *
         * `refundedAmount` rather than `status`: a PARTIAL refund deliberately
         * leaves the status at `paid`, and the invoice is no more sendable for
         * that.
         */
        /*
         * Nor once it has been called off, for the same reason.
         *
         * `InvoiceDeliveryService` refuses a cancelled invoice outright --
         * `InvoiceNotSendableError` with reason `'cancelled'` -- so the button
         * was drawn beside the words "the payment request was cancelled",
         * offering to send the very document the line above says is void, and
         * answering with a 400 when pressed.
         *
         * Decided here rather than on the button, because `canResend` feeds
         * four controls and patching the one that was reported would leave the
         * other three offering the same impossible action.
         */
        canResend:
          Boolean(payment.outstandingInvoiceId || payment.invoiceId) &&
          (payment.refundedAmount ?? 0) <= 0 &&
          payment.invoiceStatus !== 'cancelled',
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
  /*
   * ── ASKED, ANSWERED, OR RECORDED ────────────────────────────────────────
   *
   * `intake_sent_at` is the third, and it is the one that was missing. Three
   * places used to write a SENTINEL into `intake_responses` —
   * `{ template_id: '', template_key: 'pending', responses: {} }` — for no
   * reason except to make this line true, so that the journey would draw an
   * "intake pending" step.
   *
   * That column exists now and is stamped by the send itself, so the sentinel
   * was a second source of truth that could only disagree with the first. It
   * also set `intake_responses` non-null with empty answers, which every other
   * reader has to special-case.
   *
   * Reading the column directly lets the sentinel go. Strictly additive: this
   * can only make the step appear where it already should have.
   * ────────────────────────────────────────────────────────────────────────
   */
  const hasIntakeData =
    (booking.intake_responses != null) ||
    (booking.intake_completed_at != null) ||
    (booking.intake_sent_at != null);

  /*
   * Shown when there is a response, OR when the business collects intake at all
   * AND this sale has an occasion for one — the second is what makes an unsent
   * form reachable.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A PRODUCT HAS NO INTAKE.
   *
   * An intake form is what you ask someone BEFORE you see them. A purchase with
   * no appointment has nothing to prepare for, so the step was drawing a card
   * about a form that would never be sent and could not usefully be sent —
   * complete, after this change, with a status line explaining it had not been.
   *
   * `resolveIntakeForSending` already draws this exact line on the client's own
   * manage page: "Asked of the service as well as the business, because a quote
   * request or a product has no occasion for one however the settings are
   * configured." The journey was the surface that had not been told.
   *
   * `hasIntakeData` still wins. If a response exists the step appears whatever
   * the service now says, because the record outlives the configuration — a
   * service switched from scheduled to unscheduled must not erase the answers
   * a client already gave.
   * ───────────────────────────────────────────────────────────────────────────
   */
  /*
   * ── THE OTHER HALF OF THE RULE ──────────────────────────────────────────
   *
   * The comment above already names TWO kinds of sale with no occasion for a
   * form: "a quote request or a product". Only the product half was ever
   * coded. `!isUnscheduled` catches the product; nothing caught the quote.
   *
   * So a scheduled QUOTE drew the step, offered "Send client form", and the
   * server refused the send with "This service does not collect an intake
   * form" — a button whose only outcome was a red banner. Seen on an owner's
   * own booking: a quotation with a real meeting on Wed 28 Oct.
   *
   * Taken from `intakeAppliesToService` rather than written again here,
   * because that is the function `resolveIntakeBlock` refuses with. Two
   * copies of this rule is exactly how one came to be missing a clause.
   *
   * `!isUnscheduled` stays beside it: it carries a fallback the shared rule
   * does not, treating a booking with no `is_scheduled` AND no start time as
   * unscheduled. Together they are a superset of both, so this can only
   * remove steps that had nothing to offer.
   */
  const intakeHasAnOccasion = intakeAppliesToService(booking.service) && !isUnscheduled;

  if (hasIntakeData || (collectsIntake && intakeHasAnOccasion)) {
    /*
     * WHERE THE FORM ACTUALLY STANDS.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * This step carried a status colour and nothing else, so the card drew a
     * heading — טופס לקוח — over an empty box. Every state that is not
     * "answered" looked identical: a form sent three days ago and chased once,
     * a form that was never sent, and a form the client will never be asked for
     * because the job was cancelled, all rendered as the same blank card.
     *
     * The timestamps were on the row the whole time. Only `intake_completed_at`
     * was read, which is why the step could answer "is there a response" and no
     * other question about it.
     *
     * `sent` is the fact that matters to an owner looking at a blank card: the
     * question in their head is "did we ask them yet", and that is the one
     * thing the card could not say.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const intakeText: Record<string, Record<string, string>> = {
      en: {
        answered: 'Completed',
        reminded: 'Reminded',
        awaiting: 'Sent, awaiting a reply',
        unanswered: 'Sent, never completed',
        unsent: 'Not sent yet',
        never: 'Never sent',
      },
      es: {
        answered: 'Completado',
        reminded: 'Recordatorio enviado',
        awaiting: 'Enviado, esperando respuesta',
        unanswered: 'Enviado, sin completar',
        unsent: 'Aún no enviado',
        never: 'No se envió',
      },
      he: {
        answered: 'מולא',
        reminded: 'נשלחה תזכורת',
        awaiting: 'נשלח, ממתין למילוי',
        unanswered: 'נשלח, לא מולא',
        unsent: 'טרם נשלח',
        never: 'לא נשלח',
      },
    };

    const words = intakeText[language] || intakeText.en;

    /*
     * The date beside the word, because "sent" without "when" does not tell an
     * owner whether chasing is overdue. Formatted on the business's clock, like
     * every other date this function prints.
     */
    const on = (at?: string | null) => (at ? ` · ${formatDateTime(new Date(at))}` : '');

    /*
     * NOBODY IS WAITING ON A BOOKING THAT IS OVER.
     *
     * "Sent, awaiting a reply" is a live state: it says the ball is with the
     * client and the owner may want to chase. On a cancelled booking that is
     * false — the meeting it was preparing for is not happening, and the form
     * will never be filled in. The journey was still reporting the chase.
     *
     * The step's own status already reads `skipped` here; this is the sentence
     * catching up with it.
     */
    const stillWaiting = !isCompleted && !isCancelled;

    const intakeDetails = hasIntake
      ? `${words.answered}${on(booking.intake_completed_at)}`
      : booking.intake_sent_at
        ? !stillWaiting
          /* Sent, and the booking ended without it coming back. The date it
             went out is kept: it is the record of having asked. */
          ? `${words.unanswered}${on(booking.intake_sent_at)}`
          : booking.intake_reminded_at
          /* Both dates: when they were asked, and when they were chased. The
             gap between the two is the thing worth seeing. */
          ? `${words.awaiting}${on(booking.intake_sent_at)} · ${words.reminded}${on(booking.intake_reminded_at)}`
          : `${words.awaiting}${on(booking.intake_sent_at)}`
        /* Never sent. "Not sent YET" only while there is still a point — once
           the booking is cancelled or done, yet is over and the card should
           say so rather than imply an action the owner should still take. */
        : isCompleted || isCancelled
          ? words.never
          : words.unsent;

    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE STATE WORD BELONGS ON THE TITLE, THE DATES BELONG UNDER IT.
     *
     * `intakeDetails` is "word · date", and the word is the only part an owner
     * scanning the rail actually needs: sent, answered, not sent yet. Buried on
     * the line below, every stage read as a name with no state, and the state
     * sat in a row of grey text competing with timestamps.
     *
     * Derived from the same branches rather than re-decided, and stripped off
     * the front of `details` so the two can never say different things or
     * repeat each other.
     * ───────────────────────────────────────────────────────────────────────
     */
    const intakeState = hasIntake
      ? words.answered
      : booking.intake_sent_at
        ? !stillWaiting
          ? words.unanswered
          : words.awaiting
        : isCompleted || isCancelled
          ? words.never
          : words.unsent;

    const intakeRest = intakeDetails.startsWith(intakeState)
      ? intakeDetails.slice(intakeState.length).replace(/^\s*·\s*/, '')
      : intakeDetails;

    steps.push({
      id: `${booking.id}-intake`,
      key: 'intake',
      status: hasIntake ? 'completed' :
              isUpcoming ? 'active' :
              isCompleted || isCancelled ? 'skipped' : 'pending',
      details: intakeRest,
      /*
       * `sendable` is the gate above, carried to the surface that draws the
       * button. The step can still appear when the rule says no — a form
       * already sent or answered keeps its step, because the record outlives
       * the configuration — and in exactly that case there is nothing left to
       * send. Without this, a service switched to `proposal` after a send
       * would keep offering a button the server refuses.
       */
      metadata: { state: intakeState, sendable: collectsIntake && intakeHasAnOccasion },
      /*
       * The form's own date, so the step files under the day it happened.
       *
       * It had only `intake_completed_at`, so an unanswered form was undated
       * and fell into the journey's undated group — between two runs of the
       * same day, which is what made the date header repeat on the card that
       * reported this. Falls back through chased → sent → nothing.
       */
      timestamp:
        booking.intake_completed_at || booking.intake_reminded_at || booking.intake_sent_at
    });
  }

  // Step 5: Email Confirmation (booking confirmation email sent to client)
  // This is sent automatically when booking is created
  const emailStatus = confirmationEmail?.status || 'sent'; // Assume sent if no data (auto-sent on booking)
  const emailDetails = confirmationEmail?.subject || undefined;  // Show email subject

  steps.push({
    id: `${booking.id}-confirmation`,
    key: 'confirmation',
    /*
     * `complained` belongs with the failures.
     *
     * It matched none of these branches and fell through to the `: 'completed'`
     * default at the end, so a client who marked the confirmation as spam had
     * that step drawn as a green tick — asserting the opposite of what happened,
     * which is worse than saying nothing.
     *
     * The compiler could not catch it: `BookingConfirmationEmail.status` in
     * ./types.ts omitted `'complained'`, so the ladder looked exhaustive.
     */
    status: emailStatus === 'opened' || emailStatus === 'clicked' ? 'completed' :
            emailStatus === 'delivered' || emailStatus === 'sent' ? 'completed' :
            emailStatus === 'bounced' || emailStatus === 'complained' || emailStatus === 'failed' ? 'failed' :
            emailStatus === 'pending' ? 'active' : 'completed',
    details: emailDetails,
    timestamp: confirmationEmail?.sentAt || booking.created_at,  // Email sent when booking created
    /*
     * WHAT BECAME OF IT, not just what it said.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * The card printed `details` — the SUBJECT LINE — and nothing else, so it
     * read as a sentence in the CLIENT's voice ("your meeting has been
     * confirmed") on the OWNER's screen, and never said whether the mail
     * actually arrived. A bounced confirmation looked exactly like a delivered
     * one: same subject, same row.
     *
     * Every field below was already on the row and already selected. None of it
     * reached the card.
     *
     * `hasRecord` is the one that is not a passthrough, and it matters: the
     * status above falls back to `'sent'` when no email row exists at all
     * ("assume sent if no data"), which is a reasonable default for colouring a
     * step and a lie if the card states it as a fact. The card uses this to say
     * "not recorded" instead of claiming a send nothing witnessed.
     * ─────────────────────────────────────────────────────────────────────────
     */
    metadata: {
      emailStatus,
      hasRecord: Boolean(confirmationEmail),
      sentAt: confirmationEmail?.sentAt,
      deliveredAt: confirmationEmail?.deliveredAt,
      openedAt: confirmationEmail?.openedAt
    }
  });

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * STEP 6: THE MEETING, OR THE DELIVERY — AND NEITHER ON A QUOTED PACKAGE.
   *
   * `session` for a service with a time, `fulfillment` for a product without
   * one. A quoted job with NO initial visit gets neither, and that is the case
   * this skip exists for.
   *
   * Such a job is quoted, agreed, and only then does the work appear — as
   * RECURRING MEETINGS created against this booking, each with its own row and
   * its own place in the diary. That is the whole reason it has no initial
   * meeting: the meetings come later and there are several of them.
   *
   * So "אספקת השירות" was a step nobody could ever action. It sat at the end of
   * the journey as a permanent open item, describing work that will be tracked
   * by the sessions themselves rather than by a tick here — and the quoted job
   * WITH a visit has no such step either, which is the shape this one should
   * match. The journey ends where the owner's part ends: the quote, and the
   * money.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const quotedWithoutVisit = isQuotedBooking && isUnscheduled;

  if (!quotedWithoutVisit) steps.push({
    id: `${booking.id}-final`,
    key: isUnscheduled ? 'fulfillment' : 'session',
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
   * THE CONFIRMATION COMES BEFORE THE MONEY.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `confirmation` is pushed after `payment` purely because it is built from
   * the email record, which is read later — an order of CONSTRUCTION that was
   * never an order of EVENTS.
   *
   * What the client lives through is: the booking is taken, they are told it is
   * confirmed, then the money is collected — and for an instalment plan the
   * money keeps arriving for weeks afterwards, so the payment node is the one
   * thing on the journey that is still open when everything above it has
   * settled. Drawn before the confirmation it claims the client paid before
   * they were told the booking existed.
   *
   * It also stops the date headers repeating. The dated steps all carry the
   * same timestamp; the undated ones (`intake`, and `fulfillment` on a product)
   * were separating two runs of the same day, so the journey drew "14 באוק׳"
   * twice with an undated card wedged between. Moving the confirmation up puts
   * the dated steps in one run and the undated ones after it.
   *
   * Done here rather than by moving the push: the confirmation step is built
   * from data gathered below the payment step, and reordering the pushes would
   * mean moving that gathering too. This states the sequence as a fact about
   * the journey, in one place, next to the other one.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const confirmationAt = steps.findIndex(s => s.key === 'confirmation');
  const paymentAt = steps.findIndex(s => s.key === 'payment');

  if (confirmationAt > -1 && paymentAt > -1 && confirmationAt > paymentAt) {
    const [confirmation] = steps.splice(confirmationAt, 1);
    steps.splice(paymentAt, 0, confirmation);
  }

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE CONFIRMATION COMES BEFORE THE FORM, BECAUSE IT ALREADY HAPPENED.
   *
   * The intake step was pushed first, so a journey opened:
   *
   *     ההזמנה נוצרה   15:54   ✓
   *     טופס לקוח              טרם נשלח        ← second, and marked ACTIVE
   *     אישור          15:54   ✓  מייל נשלח
   *
   * — a step that has not happened sitting between two that did, both stamped
   * the same minute. The rail stopped describing a sequence.
   *
   * The confirmation is sent the instant the booking is made and is therefore
   * always the second thing that happens. The form may be sent later, or never:
   * it is a task, not an event, and a task belongs after the record of what has
   * actually occurred.
   *
   * Its own pass rather than a different push position, for the reason the
   * block above gives: the sequence is one fact about how a booking unfolds and
   * it belongs in one place, where all of it can be read at once.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const intakeAt = steps.findIndex(s => s.key === 'intake');
  const confirmAt = steps.findIndex(s => s.key === 'confirmation');

  if (intakeAt > -1 && confirmAt > -1 && intakeAt < confirmAt) {
    const [intake] = steps.splice(intakeAt, 1);
    // Re-found: removing the intake shifted everything after it by one.
    steps.splice(steps.findIndex(s => s.key === 'confirmation') + 1, 0, intake);
  }

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
  /*
   * ── THE JOB ENDING IS ITS OWN EVENT, AND IT IS ALWAYS LAST ───────────────
   *
   * A node, not a line inside the meeting's history. Calling off the work is
   * something that happened to the BOOKING, in the journey's own sequence —
   * the same standing as the booking being taken or the quote being sent — and
   * it is the last thing that happened.
   *
   * It carries the message the client was sent, which is the other half of the
   * reason it exists: that mail had nowhere to live. Filed under an attempt it
   * read as a detail of one appointment; filed nowhere it vanished. Here it
   * sits under the event it announces, and the card can offer to send it again
   * for a client who cannot find it — which is the only resend left once the
   * work has stopped, every appointment message being superseded by then.
   *
   * Appended at EVERY exit, not pushed before one. It was pushed at the end of
   * the function, after the quoted-booking reorder returns early — so on a
   * quoted job, the one shape most likely to be cancelled, the node silently
   * did not exist and the cancellation had no resend anywhere.
   *
   * On the JOB being off, not the meeting: `meeting_status: 'cancelled'` means
   * the appointment was dropped while the work continues, which is a different
   * thing and already has its own line on the rail.
   */
  const jobIsOff =
    booking.status === 'cancelled' ||
    Boolean(booking.cancel_reason) ||
    Boolean(booking.cancelled_by);

  const endingNode: BookingJourneyStep | null = jobIsOff
    ? {
        id: `${booking.id}-cancelled`,
        key: 'cancelled',
        status: 'failed',
        details: '',
        timestamp: data.cancellationEmail?.sentAt ?? booking.updated_at ?? booking.created_at,
        metadata: {
          cancelReason: booking.cancel_reason ?? null,
          cancelledBy: booking.cancelled_by ?? null,
          /* The mail, for the row beneath the node and its "send again". */
          emailId: data.cancellationEmail?.id ?? null,
          emailSubject: data.cancellationEmail?.subject ?? null,
          emailStatus: data.cancellationEmail?.status ?? null,
          emailSentAt: data.cancellationEmail?.sentAt ?? null,
        },
      }
    : null;

  /** Whatever order the journey ended up in, the ending goes last. */
  const withEnding = (list: BookingJourneyStep[]): BookingJourneyStep[] =>
    endingNode ? [...list, endingNode] : list;

  if (isQuotedBooking || data.proposal) {
    const deferred = steps.filter(s => s.key === 'proposal' || s.key === 'payment');
    const rest = steps.filter(s => !deferred.includes(s));

    /*
     * A VISIT, which the quote follows. `fulfillment` is NOT one.
     *
     * This matched `session || fulfillment`, and the two are opposite ends of
     * the job: a visit is where the work gets SCOPED, so the quote comes after
     * it, while fulfilment is the work being DELIVERED, which cannot happen
     * until the quote has been sent and agreed.
     *
     * On a quoted package with no meeting that put "אספקת השירות" above
     * "הצעת מחיר" — the drawer telling the owner to deliver a job nobody had
     * priced yet. It also made the branch below unreachable for the one case
     * its own comment describes.
     */
    const visitAt = rest.findIndex(s => s.key === 'session');

    if (deferred.length > 0 && visitAt !== -1) {
      /*
       * Inserted directly AFTER the visit, not appended to the end.
       *
       * They coincide today, because `session` happens to be the last step
       * pushed — but the two are different instructions, and the one that
       * survives someone adding a step below is "follows the visit".
       */
      return withEnding([
        ...rest.slice(0, visitAt + 1),
        ...deferred,
        ...rest.slice(visitAt + 1),
      ]);
    }

    /*
     * No visit, but something to deliver: the quote goes BEFORE the delivery.
     * A treatment package is quoted, agreed, and only then given.
     */
    const deliveryAt = rest.findIndex(s => s.key === 'fulfillment');

    if (deferred.length > 0 && deliveryAt !== -1) {
      return withEnding([
        ...rest.slice(0, deliveryAt),
        ...deferred,
        ...rest.slice(deliveryAt),
      ]);
    }

    // Neither a visit nor a delivery — a request with nothing attached yet.
    // The quote is then simply the next thing that happens.
    if (deferred.length > 0) return withEnding([...rest, ...deferred]);
  }

  return withEnding(steps);
}

interface CRMContactDrawerV2Props {
  contact: CRMContact;
  stages: CRMPipelineStage[];
  enabledCapabilities?: string[];
  isOpen: boolean;
  onClose: () => void;
  /**
   * Something about this contact changed.
   *
   * Pass the saved row when there is one: the parent uses it to refresh the
   * open drawer in place. Called with nothing for a change the parent should
   * merely re-read the list after — a booking, a deletion — which is why the
   * argument is optional rather than required.
   *
   * It used to take nothing at all, and the parent responded by closing the
   * drawer and reloading the whole list. Saving one phone number therefore
   * threw the owner out of the record they were editing, and the "Saved"
   * confirmation this component sets for two seconds was unmounted before it
   * could be read.
   */
  onContactUpdated: (updated?: CRMContact) => void;
  onTasksUpdated?: () => void;
  initialSection?: 'details' | 'bookings' | 'tasks' | 'forms' | 'files' | 'payments';
  /**
   * A booking to open expanded, when a link named one.
   *
   * Paired with `initialSection='bookings'`: the section says which list, this
   * says which row in it. Undefined for every ordinary open, where expanding
   * something the owner did not ask for would be noise.
   */
  focusBookingId?: string;
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
  /* Said at the picker, where the file was chosen — not after a failed send. */
  const [fileError, setFileError] = useState<string | null>(null);

  /**
   * Take the file, or say why not, BEFORE anything is uploaded.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Both answers used to come from the server, and the size one could not:
   * an oversized upload was refused by the platform at the edge, so the reply
   * was not JSON and the owner got a generic failure with no reason in it. A
   * limit the picker knows is a limit the picker can state.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const take = (candidate: File) => {
    if (candidate.size > MAX_DOCUMENT_BYTES) {
      setFileError(
        (t('crm.drawer.upload_too_large') || 'That file is too large. The limit is {max}MB.')
          .replace('{max}', String(MAX_DOCUMENT_MB))
      );
      return;
    }

    if (candidate.type && !ATTACHABLE_DOCUMENT_TYPES.includes(candidate.type)) {
      setFileError(
        (t('proposal.error_file_type') || 'That kind of file cannot be attached ({type}).')
          .replace('{type}', candidate.type)
      );
      return;
    }

    setFileError(null);
    setFile(candidate);
    if (!docName) {
      setDocName(candidate.name.replace(/\.[^/.]+$/, ''));
    }
  };

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
      take(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      take(e.target.files[0]);
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
    setFileError(null);
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
          {/* Why the file was not taken, beside the control that would have
              taken it. Previously the only way to learn this was to send the
              file and read a failure, and the one that mattered most — too
              large — never produced a readable one at all. */}
          {fileError && (
            <p
              role="alert"
              className="flex items-start gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-[12.5px] text-red-600 dark:text-red-400"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {fileError}
            </p>
          )}

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
              /*
                THE SHARED LIST, not a fourth hand-written copy.
                ─────────────────────────────────────────────────────────────
                This was extensions, and it was MISSING the two formats the
                bucket had just been widened to take: `.tiff` from a desk
                scanner and `.heic` from an iPhone camera. So the allow-list
                accepted a scan and the picker would not offer one — on iOS,
                where every photo is HEIC, the file simply did not appear.
                `ATTACHABLE_ACCEPT` is built from the same constant the bucket
                and both routes validate against.
              */
              accept={ATTACHABLE_ACCEPT}
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
                  {/* The real number, from the same constant the picker
                      enforces. It read "Max 10MB" while the limit was 50. */}
                  {(t('crm.document.max_size') || 'Max {max}MB').replace('{max}', String(MAX_DOCUMENT_MB))}
                  {' • '}
                  {t('crm.document.supported_formats') || 'PDF, DOC, XLS, Images'}
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


/**
 * A booking row, joined with the service the drawer needs from it.
 *
 * `SchedulingBooking` does not declare `service` — the join is added by the
 * queries that fetch bookings for this drawer — so the two places that built an
 * `Appointment` each cast it themselves, and one of them forgot.
 */
type BookingWithService = SchedulingBooking & {
  /*
   * The attempts, attached by `/api/scheduling/bookings` when the fetch passes
   * `include_attempts=true`. Optional because every other caller of that route
   * does not ask for them.
   */
  attempts?: MeetingAttempt[];
  service?: {
    service_name: string;
    price?: number | null;
    currency?: string;
    is_scheduled?: boolean | null;
    sale_mode?: 'direct' | 'proposal' | null;
    /*
     * The plan fields, which `findAll` has always selected and this type never
     * declared.
     *
     * Not cosmetic: `buildSessionPlan` tests `payment_type === 'installments'`,
     * so without them the helper cannot recognise a plan at all — and because
     * every field of its `service` parameter is optional, TypeScript's weak-type
     * rule was the only thing that noticed, by refusing an object with none of
     * them in common.
     */
    payment_type?: string | null;
    installment_count?: number | null;
    installment_frequency?: string | null;
  } | null;
  /* On the row and selected by `*`; declared here so `toAppointment` can carry
     them. The intake step reads these to say where the form stands. */
  intake_sent_at?: string | null;
  intake_reminded_at?: string | null;
};

/**
 * A booking row as the drawer's `Appointment` view model.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A FUNCTION AND NOT TWO OBJECT LITERALS
 *
 * There were two, forty lines apart, listing the same fifteen fields. They had
 * already drifted: one coerced `client_email` with `|| undefined` and the other
 * assigned it raw, one cast `service` and the other read it off a type that has
 * no such property. Every one of those was a type error, and none of them was
 * visible while the two lists were read separately.
 *
 * The coercions are not cosmetic. `client_first_name` and its siblings are
 * DERIVED fields: `scheduling_bookings.client_first_name` was dropped by
 * `20260810_remove_client_fields_and_total_amount.sql`, and the repository
 * synthesises them from the joined contact — so they are `null` whenever the
 * contact has no name recorded, while `Appointment` declares a plain `string`.
 * Empty string rather than null because every consumer reads these through
 * `[first, last].filter(Boolean)`, where the two behave identically.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/**
 * Pair each attempt with the mail sent about it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * On `email_sends.meeting_id` (20261077), so this is the RECORDED link rather
 * than a guess. The journey could not do this before: it matched mail to a
 * booking by creation time and subject, and a booking rescheduled after a
 * no-show has several attempts that a booking-level heuristic cannot tell
 * apart — every mail landed on the first.
 *
 * Attempts whose mail predates the column get an empty list, which renders as
 * an attempt with no mail beneath it. That is honest: nothing recorded what was
 * sent about them.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function attachAttemptEmails(
  attempts: MeetingAttempt[] | undefined,
  emails: Array<{ id: string; subject: string; sent_at: string | null; created_at: string; status: EmailSendStatus; meeting_id?: string | null; is_resend?: boolean; email_kind?: string | null }>
): MeetingAttempt[] | undefined {
  if (!attempts?.length) return attempts;

  return attempts.map(attempt => ({
    ...attempt,
    emails: emails
      .filter(email => email.meeting_id === attempt.id)
      .map(email => ({
        id: email.id,
        subject: email.subject,
        at: email.sent_at ?? email.created_at,
        status: email.status,
        isResend: email.is_resend ?? false,
        kind: email.email_kind ?? null,
      }))
      /* Oldest first, matching the order the attempts themselves read in. */
      .sort((a, b) => new Date(a.at ?? 0).getTime() - new Date(b.at ?? 0).getTime()),
  }));
}

/**
 * The message that told the client the booking is off.
 *
 * Found by KIND, not by subject: `email_kind` records what each message was
 * (20261081), and matching "cancelled" in subject text would catch the
 * meeting-only notice too — the one that says the quote is still coming.
 * Newest, because a cancellation can be sent again.
 */
function findCancellationEmail(
  emails: Array<{ id: string; subject: string; status: EmailSendStatus; sent_at: string | null; created_at: string; booking_id?: string | null; email_kind?: string | null }>,
  bookingId: string
) {
  return emails
    .filter(e => e.booking_id === bookingId && e.email_kind === 'booking_cancelled')
    .sort((a, b) =>
      new Date(b.sent_at ?? b.created_at).getTime() - new Date(a.sent_at ?? a.created_at).getTime()
    )[0];
}

export function toAppointment(booking: BookingWithService): Appointment {
  return {
    id: booking.id,
    service_id: booking.service_id,
    client_first_name: booking.client_first_name ?? '',
    client_last_name: booking.client_last_name ?? undefined,
    client_email: booking.client_email ?? undefined,
    client_phone: booking.client_phone ?? undefined,
    start_time: booking.start_time,
    end_time: booking.end_time,
    timezone: booking.timezone ?? undefined,
    status: booking.status,
    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE TWO THIS FUNCTION'S OWN WARNING WAS ABOUT.
     *
     * The note below says it outright: this copies field by field, so a new
     * column is invisible until it is named here. Both of these were added to
     * the table and read by code downstream, and both stopped at this line.
     *
     * `meeting_status` is the worse of the two by far. It is the appointment's
     * own outcome — held, missed, called off — and `quoteGate`, the next-step
     * banner, the header badge and whether the card opens itself ALL read it.
     * Arriving as `undefined`, every one of them behaved as though no meeting
     * had ever been marked, however many times the owner had marked it.
     *
     * `booking_source` is how the booking came to exist, and the journey's
     * opening row is the only place it shows. Without it that row printed the
     * client's name and nothing else.
     * ───────────────────────────────────────────────────────────────────────
     */
    meeting_status: booking.meeting_status ?? null,
    /*
     * WHO gave that outcome — the same mistake as `meeting_status` above, one
     * column later, and the comment block above is the record of it.
     *
     * `auto_complete_meetings` marks an overdue meeting held and stamps
     * `outcome_by: 'system'`, because held is the only answer available to a
     * clock. The repository returns it (`select('*')`), the route passes it
     * through untouched — and this mapper, which names its fields one by one,
     * did not name it. So the value existed everywhere except the one place
     * that reads it, and every consumer saw `undefined`:
     *
     *   · the row's correction controls — no-show, cancel, and the
     *     confirmation that raises the invoice the automation withheld — are
     *     offered only on a system-held row, so they never appeared.
     *   · the "marked automatically" badge beside the status could not fire.
     *
     * Both read a booking that had already forgotten who answered for it.
     */
    outcome_by: booking.outcome_by ?? null,
    /*
     * The attempts, where the fetch asked for them.
     *
     * Named here for the same reason as `meeting_status` above, which is the
     * mistake this comment block exists to record: a column the API returns and
     * this function does not copy arrives as `undefined`, and every reader
     * downstream behaves as though it never existed. No error, no log.
     *
     * Left undefined when the fetch did not request attempts — which the
     * journey treats as "draw the single meeting node", not as "no attempts".
     */
    attempts: booking.attempts ?? undefined,
    booking_source: booking.booking_source ?? null,
    notes: booking.notes ?? undefined,
    // A package's meeting, and which one. Null on every ordinary booking.
    parent_booking_id: booking.parent_booking_id ?? null,
    occurrence_number: booking.occurrence_number ?? null,
    /*
     * Why it was cancelled, and by whom.
     *
     * This function copies field BY FIELD rather than spreading, which is
     * deliberate — the card should get what it needs and not a whole DB row —
     * but it also means a new column is invisible until it is named here. The
     * API returns the full row and the badge was written to read these, and the
     * reason still showed nothing, because it stopped at this line.
     */
    cancel_reason: booking.cancel_reason ?? null,
    cancel_note: booking.cancel_note ?? null,
    cancelled_by: booking.cancelled_by ?? null,
    cancellation_reason: booking.cancellation_reason ?? null,
    /* The owner's answer about the quote (20261083). Named here for exactly
       the reason the note above gives: the API returns it, and it would be
       invisible to the card until this line exists. */
    proposal_continues: booking.proposal_continues ?? null,
    intake_responses: booking.intake_responses ?? undefined,
    intake_completed_at: booking.intake_completed_at ?? undefined,
    intake_sent_at: booking.intake_sent_at ?? undefined,
    intake_reminded_at: booking.intake_reminded_at ?? undefined,
    created_at: booking.created_at ?? undefined,
    service: booking.service
      ? {
          service_name: booking.service.service_name,
          is_scheduled: booking.service.is_scheduled,
          sale_mode: booking.service.sale_mode,
          currency: booking.service.currency,
        }
      : undefined,
  };
}

/** One `payment_plan_installments` row, as both card builders select it. */
type PlanPeriodRow = {
  id: string;
  installment_number: number;
  amount: number | string;
  currency?: string | null;
  status: string;
  trigger?: 'date' | 'manual' | null;
  due_date: string | null;
  paid_at?: string | null;
  invoice_id?: string | null;
  /* The processor charge this period arrived as. An instalment has no invoice,
     so this is the only key its refund can be issued against. */
  transaction_id?: string | null;
  label?: string | null;
};

/**
 * This booking's payment plan, as the card renders it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS SHARED AND NOT INLINE
 *
 * There are TWO card builders in this file. One assembled this object; the
 * other built its `paymentData` with `amount: servicePrice` and no `plan` at
 * all. So a booking rendered by the second one lost its whole schedule, and the
 * card's "schedule not written yet" fallback then synthesised a SINGLE stage of
 * the full price and marked it paid from `booking.payment_status` — which flips
 * to `paid` on the FIRST instalment.
 *
 * A ₪800 plan with ₪400 collected reported:
 *
 *     Total ₪800 · Collected ₪800 · Outstanding ₪0
 *
 * every figure wrong except the first, and the ₪400 still to come invisible.
 * The owner could neither see the two periods nor refund the one that was paid.
 *
 * `PaymentPlanTotals` already carries a comment about this exact failure mode —
 * "Two renderers for one strip is how the card and the dialog came to print
 * different totals for one job". This is the same lesson one layer up: two
 * builders for one plan is how one of them came to print no plan.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function buildSessionPlan(input: {
  /** THIS booking's periods. The billing truth; see `totalAmount` below. */
  planPeriods: PlanPeriodRow[];
  service:
    | {
        payment_type?: string | null;
        installment_count?: number | null;
        installment_frequency?: string | null;
      }
    | undefined;
  servicePrice: number;
  serviceCurrency: string;
  /** What has actually arrived, from the transactions or a paid invoice. */
  collected: number;
  /**
   * The booking's charges, so a period can say what came back off ITSELF.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `moneyItems` documents where a period's refund lives: "the installment row
   * does not carry it: `refunded_amount` is derived by trigger onto the INVOICE
   * the period raised". True for an invoiced plan, and there is no other source
   * for one — `payment_plan_installments` HAS no `refunded_amount` column.
   *
   * A plan billed to a card raises no invoice at all. Its periods are charged
   * by Stripe against the subscription and the refund lands on the
   * TRANSACTION, so the invoice join finds nothing and every period reported
   * no refund.
   *
   * Measured 2026-10-26: booking f8df6318, period 1 of 2, $30 charged and $30
   * refunded in full. The strip above read "Refunded $30 · You keep $0" while
   * the period beneath it read "$30 Paid Oct 26" with nothing to say it had
   * gone back — and the row went on offering to refund it.
   *
   * Matched by `transaction_id`, which the period already carries and which is
   * this sale's own charge. Not inferred from amounts or dates.
   * ───────────────────────────────────────────────────────────────────────────
   */
  /* `id` optional, because the two callers' local row types declare different
     subsets of the same select. A charge with no id cannot be matched to a
     period and is skipped rather than guessed at. */
  payments?: Array<{ id?: string | null; refunded_amount?: number | string | null }>;
}): SessionPaymentPlan | undefined {
  const { planPeriods, service, servicePrice, serviceCurrency, collected, payments } = input;

  /** What each charge returned, by its own id. */
  const refundedByTransaction = new Map<string, number>();
  for (const pay of payments ?? []) {
    const amount = Number(pay.refunded_amount ?? 0) || 0;
    if (pay.id && amount > 0) refundedByTransaction.set(pay.id, amount);
  }

  /*
   * Billed in full, whatever the service was configured to do. A path that
   * ignored the plan and charged the whole price leaves exactly this trace,
   * and the card must follow it rather than the configuration.
   *
   * ONLY where no periods exist to contradict it. This is a heuristic read of
   * a single number, and the installment rows are direct evidence: a booking
   * with two ₪400 periods was demonstrably not billed ₪800 in one go, however
   * much has since been collected against it. Without that guard a plan whose
   * last period is paid — collected == price — stops being a plan on the very
   * screen that reports it, and the owner loses the schedule and the refund
   * buttons at the moment the history matters most.
   */
  const billedInFull = planPeriods.length === 0 && collected > 0 && collected >= servicePrice;

  const isPlan =
    service?.payment_type === 'installments' &&
    (service.installment_count ?? 1) > 1 &&
    servicePrice > 0 &&
    !billedInFull;

  if (!isPlan) return undefined;

  const paidPeriods = planPeriods.filter(p => p.status === 'paid');

  /*
   * The next period the client owes, which is what the owner is asked about.
   * Falls back to the last period so a finished plan still names one.
   */
  const nextPeriod = planPeriods.find(p => p.status !== 'paid' && p.status !== 'cancelled');

  return {
    installmentCount: planPeriods.length || service!.installment_count!,
    /*
     * The period the plan is ON. Taken from the real rows where they exist —
     * the first period's projected amount is only right until one has been
     * paid — and from the projection before the schedule has been written,
     * which is the window between booking and the processor confirming.
     */
    installmentAmount: planPeriods.length
      ? Number((nextPeriod ?? planPeriods[planPeriods.length - 1]).amount)
      : fromMinorUnits(
          planPhases(servicePrice, serviceCurrency, service!.installment_count!)[0].amountMinor,
          serviceCurrency
        ),
    /*
     * THIS BOOKING'S OWN PERIODS — not the service's price, and not the plan
     * row's total either.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * Both of those are SERVICE-level and both move when the owner edits the
     * service. `syncServicePaymentPlan` rewrites `payment_plans.total_amount`
     * and `installment_count` from the service every time it is saved, and
     * `scheduling_services.price` is the live figure itself. Neither is a
     * record of what any particular client agreed to — and `payment_plans` has
     * no `booking_id` at all: one row serves every booking of that service.
     *
     * The installments ARE. They are written once, at checkout, from the
     * `plan_total` and `plan_count` frozen into the Stripe session metadata —
     * so they record the deal that client actually accepted and nothing can
     * move them afterwards.
     *
     * The two diverge the moment a service is repriced after a sale. A client
     * who bought at ₪200 in two payments, on a service since raised to ₪800,
     * had their card report ₪800 total, ₪100 collected and ₪700 outstanding —
     * ₪600 of it money nobody had ever agreed to pay. Arithmetically
     * consistent, factually wrong, and nothing about it looks off.
     *
     * Falls back to the price only before any schedule exists, where it is the
     * sole estimate available and no period contradicts it.
     * ─────────────────────────────────────────────────────────────────────────
     */
    totalAmount: planPeriods.length
      ? planPeriods.reduce((sum, period) => sum + Number(period.amount || 0), 0)
      : servicePrice,
    frequency: (service!.installment_frequency || 'monthly') as SessionPaymentPlan['frequency'],
    periodsPaid: planPeriods.length ? paidPeriods.length : undefined,
    /*
     * The dated list, exactly as a quoted job shows its stages — same shape,
     * same renderer. Omitted entirely when no schedule has been written yet, so
     * the card falls back to its summary rather than showing an empty list.
     */
    stages: planPeriods.length
      ? planPeriods.map(p => ({
          id: p.id,
          label: p.label ?? null,
          amount: Number(p.amount),
          status: p.status,
          trigger: p.trigger ?? 'date',
          invoiceId: p.invoice_id ?? null,
          transactionId: p.transaction_id ?? null,
          /* What came back off THIS period. The row reads it as
             `stage.refundedAmount` to cross the line through and to stop
             offering a refund on money already returned. */
          refundedAmount: p.transaction_id
            ? refundedByTransaction.get(p.transaction_id) ?? undefined
            : undefined,
          dueDate: p.due_date,
          paidAt: p.paid_at ?? null,
        }))
      : undefined,
  };
}

export function CRMContactDrawerV2({
  contact,
  stages,
  enabledCapabilities = [],
  isOpen,
  onClose,
  onContactUpdated,
  onTasksUpdated,
  initialSection = 'details',
  focusBookingId
}: CRMContactDrawerV2Props) {
  const { t, isRTL, language, timezone, timeZoneOptions } = useLanguage();
  // Whether the configuration dialog is up — see the Sheet below for why this
  // drawer must not dismiss itself while it is.
  const configurationOpen = useConfigurationDialogOpen();

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

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * EVERY BOOKING ON SCREEN, a package's meetings included.
   *
   * `sessions` is the CARD list, and since a package's meetings became a step
   * inside their quote's journey they are no longer in it — they hang off
   * `card.meetings`. Every lookup by booking id then quietly found nothing:
   * the reschedule button on a meeting row did nothing at all, the cancel
   * dialog could not tell whether the thing being cancelled had an hour, and
   * the drawer's count of upcoming appointments dropped six.
   *
   * One flat view, so a card action against any booking id works wherever that
   * booking is drawn.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const everyBooking = () => sessions.flatMap(card => [card, ...(card.meetings ?? [])]);
  const findSession = (bookingId: string) =>
    everyBooking().find(card => card.booking.id === bookingId);
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
    /**
     * Reading a quote already sent, rather than writing one.
     *
     * Same dialog, same data — `basedOn` is what a revision already opens on, so
     * viewing needs no second component and no extra fetch. Revising from the
     * view flips this off and sets `supersedesId`, which is the exact state the
     * revise path has always used.
     */
    readOnly?: boolean;
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
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A REF, AND FETCHED BY THE LOAD THAT NEEDS IT.
   *
   * This was `useState` with its own effect, and the journey never saw a true
   * value. `loadAllContactData` is a plain async function called from an effect
   * keyed on `[contact.id, isOpen]`, so it CAPTURED the state from the render
   * where the drawer opened — `false`, always, because no answer existed yet.
   * `setCollectsIntake(true)` a moment later re-rendered the component but
   * could not reach into a closure already running, and nothing rebuilt the
   * cards.
   *
   * The symptom was exact: the intake step was missing ON OPEN and appeared
   * after any action that called `fetchSessions`, which is recreated each
   * render. That is the same shape as the warning on `processBookingsData` —
   * a refund that showed only after a refresh.
   *
   * So the answer is now awaited inside the load that needs it and handed to
   * the builder as an argument, which removes the ordering question rather
   * than winning it. The ref is what lets the other caller, `fetchSessions`,
   * read today's value from its own closure.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const collectsIntakeRef = useRef(false);

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
  /**
   * The SESSION the booking dialog is open on, when it is one.
   *
   * A package is one booking with N meetings, so a session has no booking to
   * save — the dialog posts to `/api/scheduling/meetings/[id]/reschedule`,
   * which writes a second attempt at that session and releases the hour the
   * old one held. Null for every ordinary booking.
   */
  const [reschedulingMeetingId, setReschedulingMeetingId] = useState<string | null>(null);
  /*
   * ADDING A MEETING TO A PACKAGE, which borrows the booking dialog to choose
   * the hour and then writes through the meetings endpoint — see `onPickSlot`.
   * Null whenever the dialog is doing its ordinary job.
   */
  const [addMeetingTo, setAddMeetingTo] = useState<{
    containerId: string;
    serviceId: string;
    billsPerMeeting: boolean;
    /** How long one session runs, from the quote that sold them. */
    sessionMinutes: number | null;
    /** Where the series says the next one falls; null when it has no rhythm. */
    nextLocal: string | null;
    /** And the few after that, to offer instead of "today, tomorrow". */
    upcoming: string[];
    /**
     * The sessions of this package that were called off or missed and have
     * nothing standing in for them yet — so the dialog can ask which, if any,
     * the new session makes up for.
     *
     * Empty for an ordinary package with nothing outstanding, and then the
     * dialog asks nothing.
     */
    makeUpCandidates: { id: string; label: string }[];
  } | null>(null);
  /* The owner's answer about the money, asked beside the date in that dialog. */
  const [chargeNewMeeting, setChargeNewMeeting] = useState(false);
  /*
   * And their answer about WHICH missed session this one stands in for.
   *
   * Null is the default and the honest one: a session added to a package is an
   * ordinary session unless the owner says it replaces something. Nothing is
   * inferred — a package with two gaps, one made up and one still waiting on
   * the client, is indistinguishable from any count. See 20261097.
   */
  const [makeUpForId, setMakeUpForId] = useState<string | null>(null);
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
  /*
   * Typed as the booking modal's `WeeklyAvailability`, which is what it is
   * handed to. Held as `Record<string, …>` it could not be passed at all:
   * `WeeklyAvailability` is a fixed-key INTERFACE, and an interface gets no
   * implicit index signature, so the record is not assignable to it. The same
   * narrowing is done in the public availability route, for the same reason.
   */
  const [availability, setAvailability] = useState<WeeklyAvailability | undefined>(undefined);
  /* The zone those hours are written in: the booking dialog renders on the
     business's clock, not the browser's. */
  const [bookingTimezone, setBookingTimezone] = useState<string>('UTC');
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
  /* One object, not a pair of flags: the id and whether a quote is in play are
     only ever meaningful together, and a half-set pair is how a dialog ends up
     open against the wrong booking. */
  const [pendingMeetingCancel, setPendingMeetingCancel] = useState<
    {
      bookingId: string;
      isQuoted: boolean;
      /**
       * The SESSION being called off, when it is one of a package.
       *
       * A session has no booking of its own, so its outcome is recorded
       * against the meeting. Null for an ordinary booking, whose single
       * meeting is reached through the booking.
       */
      meetingId?: string | null;
    } | null
  >(null);
  /*
   * The replacement session the outcome dialogs may offer.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Answered by the server, not worked out here, for three reasons the drawer
   * cannot get round: the agreed session count lives on the proposal, the hour
   * has to be clear of the WHOLE diary (this screen only ever sees one
   * contact), and the rule about which outcomes free a place has to match the
   * route that will refuse the write.
   *
   * Null means no offer, which is every ordinary booking, every full upfront
   * block, and every case where nothing is free within reach. The dialogs hide
   * the toggle on null, so a failed lookup costs the owner the offer and
   * nothing else.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [replacementOffer, setReplacementOffer] = useState<{
    containerId: string;
    proposedStart: string;
    /**
     * The proposal and the rhythm's next free beats after it, proposal first.
     *
     * One date was not enough: the next beat can be right about the pattern
     * and wrong about the week — the owner is away, or the client cannot make
     * it — and the only answer then was to decline the replacement and place
     * it by hand. These let them pick another without leaving the dialog.
     */
    options: string[];
    /** Per-session blocks bill the replacement; upfront ones already paid. */
    billsPerSession: boolean;
  } | null>(null);
  /**
   * Book the replacement the owner just agreed to.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Deliberately NOT fatal to the outcome that preceded it. The cancellation or
   * no-show is already recorded and the client has already been emailed about
   * it; a replacement that cannot be placed — the hour went in the seconds
   * since it was proposed, the block turned out to be full — must not make the
   * owner think the outcome failed and record it twice.
   *
   * So it reports and returns. The owner still has "Add another meeting", which
   * is the same write with a date they pick.
   *
   * ── WHETHER IT IS BILLED DEPENDS ON HOW THE BLOCK IS SOLD ────────────────
   *
   * UPFRONT: never. The client paid one agreed sum, and a cancelled session's
   * portion moves to its replacement. Billing again would be a second sale,
   * and the route refuses it outright.
   *
   * PER SESSION: for a cancelled session, yes. Nothing was ever paid for that
   * hour — these are billed when HELD — so its replacement needs a stage of
   * its own, or the client is given a session nobody invoices.
   *
   * A NO-SHOW make-up is never billed on either. The missed hour was held and
   * the owner has already answered the money question on that dialog; the
   * make-up is the thing they are choosing to give.
   */
  const bookReplacement = useCallback(
    async (
      containerId: string,
      startTime: string,
      charge: boolean,
      /* The session being called off, which no longer holds its place. */
      replaces: string | null
    ): Promise<boolean> => {
      try {
        const response = await fetch(`/api/scheduling/bookings/${containerId}/meetings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          /*
           * `notify: false` — this session does not announce itself. The
           * outcome that follows sends ONE mail listing every session of the
           * block, this one included, with what each is worth. Two mails a
           * second apart, the first listing a block without the replacement
           * in it, is what that avoids.
           */
          /*
           * `replaces` matters because this runs BEFORE the outcome is
           * recorded: without it the route still counts the session being
           * cancelled and refuses the block as full, which is exactly what it
           * did — the hour was called off and nothing replaced it.
           */
          body: JSON.stringify({
            start_time: startTime,
            charge,
            notify: false,
            ...(replaces ? { replaces } : {}),
          }),
        });
        const data = await response.json();

        if (!response.ok || data?.success === false) {
          toast.error(data?.error || 'The replacement session could not be added');
          return false;
        }

        return true;
      } catch (err) {
        logger.warn({ err, containerId }, 'Replacement session could not be added');
        toast.error('The replacement session could not be added');
        return false;
      }
    },
    []
  );

  const [pendingResendKind, setPendingResendKind] = useState<string>('booking_confirmed');
  const [showConfirmationResend, setShowConfirmationResend] = useState(false);
  const [pendingConfirmationBookingId, setPendingConfirmationBookingId] = useState<string | null>(null);
  const [sendingConfirmation, setSendingConfirmation] = useState(false);
  /* Cancelling emails the client and frees the slot, so it asks first.
     Completing and marking a no-show are internal record-keeping. */
  const [pendingCancelBookingId, setPendingCancelBookingId] = useState<string | null>(null);
  /*
   * Why the owner is cancelling. MANDATORY, and nothing preselected.
   *
   * The owner's list is the long one — they see the no-shows, the double
   * bookings, the duplicates and the slots that were moved rather than dropped,
   * and those last three are what let a report stop counting non-cancellations
   * as cancellations.
   */
  const [cancelReasonCode, setCancelReasonCode] = useState<OwnerCancelReason | ''>('');
  const [cancelReasonNote, setCancelReasonNote] = useState('');
  /* Whether that note is emailed to the client. Shared by default. */
  const [shareCancelNote, setShareCancelNote] = useState(true);
  /*
   * The booking awaiting a no-show confirmation.
   *
   * Confirmed for the same reason cancelling is, and one more: a no-show is a
   * JUDGEMENT recorded against this client, it lands on the timeline shown two
   * sections up, and it counts towards their no-show rate. The confirmation is
   * also where the owner decides whether to invite them back.
   */
  const [pendingNoShowBookingId, setPendingNoShowBookingId] = useState<string | null>(null);
  /**
   * The SESSION a confirmation dialog is about, when it is one.
   *
   * A package's session has no booking of its own, so its outcome goes to
   * `/api/scheduling/meetings/[id]/outcome` rather than a booking route. Set
   * alongside the pending id above so the dialogs — which are about asking the
   * owner, not about which row — stay exactly as they are.
   */
  const [pendingOutcomeMeetingId, setPendingOutcomeMeetingId] = useState<string | null>(null);
  /**
   * Whether that session still has an unbilled stage behind it.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Read by the no-show dialog, to decide whether to ask about the money at
   * all. A missed session used to do nothing to its stage: `held` bills one and
   * `cancelled` voids one, and `no_show` did neither, so the stage read
   * `pending` for ever against an hour no invoice would ever be raised for.
   *
   * The row supplies it, because the row is what is showing the stage.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [pendingOutcomeChargeable, setPendingOutcomeChargeable] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  /*
   * The accepted job the owner is stopping, if any.
   *
   * Held here rather than in the tab, for the reason the quote builder is: the
   * accordion can close under the dialog, and a half-typed reason must not
   * vanish with it.
   */
  const [stopQuoteTarget, setStopQuoteTarget] = useState<{ id: string; title: string | null } | null>(null);
  const [selectedBookingForPayment, setSelectedBookingForPayment] = useState<SessionCardData | null>(null);
  const [cancellingBooking, setCancellingBooking] = useState(false);
  /**
   * Money the business is still holding for a booking it just cancelled.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Cancelling never touches money, on purpose: a refund moves real funds and
   * belongs to a person, not to a side effect. But it cannot be forgotten
   * either — nothing on a cancelled booking said any money was held, so the
   * owner had to already know to go looking for it.
   *
   * So the cancellation reports what it did NOT do, and this asks about it
   * while they are still looking at the booking. Set only when there is
   * something to give back, which is the uncommon case.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [refundAfterCancel, setRefundAfterCancel] = useState<{
    bookingId: string;
    amount: number;
    currency: string;
  } | null>(null);
  /**
   * One milestone's money, being returned.
   *
   * Addressed by INVOICE, not by booking. A booking-scoped refund on a job with
   * several payments is a group refund — all of them, in full — because a single
   * figure cannot honestly be split across two charges. Naming the invoice is
   * what makes "return the deposit and nothing else" expressible.
   */
  const [refundStage, setRefundStage] = useState<{
    /* Either key — a milestone has an invoice, an instalment has a charge.
       `RefundModal` and `/api/payments/refunds` both accept either. */
    invoiceId: string | null;
    transactionId: string | null;
    amount: number;
    refunded: number;
    currency: string;
    label: string;
  } | null>(null);
  const [sendingIntake, setSendingIntake] = useState(false);
  /*
   * Resending the refund confirmation — the same shape as the invoice send
   * beneath it, because it is the same gesture on a different document and an
   * email to a client is confirmed before it leaves, every time.
   */
  const [showRefundEmailConfirm, setShowRefundEmailConfirm] = useState(false);
  const [pendingRefundInvoiceId, setPendingRefundInvoiceId] = useState<string | null>(null);
  const [sendingRefundEmail, setSendingRefundEmail] = useState(false);

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

  /*
   * Whether this person is still someone the business works with.
   *
   * Read from the CONTACT's stage rather than the form's, so the banner and the
   * footer button describe what is stored — not an unsaved stage the owner has
   * picked in the dropdown and may yet cancel.
   */
  const contactInactive = isContactInactive(contact?.stage, stages);

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
    /**
     * What this mail was about (20261077).
     *
     * `findConfirmationEmail` prefers this over guessing by time and subject.
     * Already on the wire — the emails route selects the whole row — so only
     * this local type was hiding it, which is the same omission the comment
     * above records for `status`.
     */
    booking_id?: string | null;
    meeting_id?: string | null;
    /*
     * Both already on the wire and both were hidden here, which is the same
     * omission the note above records. `is_resend` (20261079) and `email_kind`
     * (20261081) reach the journey only because the route selects the whole
     * row — the local type never stopped the value, it just stopped anyone
     * seeing that it was available.
     */
    is_resend?: boolean;
    email_kind?: string | null;
    subject: string;
    /*
     * The shared roster, not a hand-copied union.
     *
     * This one omitted `'complained'` — the same omission `types.ts` records as
     * the reason a spam complaint could be painted as a completed step. Naming
     * `EmailSendStatus` means the next status added reaches here on its own.
     */
    status: EmailSendStatus;
    sent_at: string | null;
    /* Written by the provider webhook while `status` stays `'sent'`, so a
       reader that consults only `status` can never report delivery. */
    delivered_at: string | null;
    opened_at: string | null;
    created_at: string;
  }

  // Process bookings data into session cards (extracted for reuse)
  // `BookingWithService`: these rows come from queries that join the service,
  // which `SchedulingBooking` does not declare. Typed here rather than cast at
  // each of the five places that read `booking.service`.
  const processBookingsData = (
    bookingsData: { bookings: BookingWithService[] },
    emailsData: { emails?: EmailRecord[] },
    proposalsList: DrawerProposal[] = [],
    /*
     * Passed in, not read from state.
     *
     * This runs inside a closure created when the drawer opened, so the state
     * it could see was always the initial `false`. The caller awaits the real
     * answer and hands it over. Defaulted to the ref rather than to `false` so
     * the other caller, `fetchSessions`, needs no change and still gets today's
     * value.
     */
    collects: boolean = collectsIntakeRef.current
  ) => {
    const emails: EmailRecord[] = emailsData.emails || [];

    // Helper to find confirmation email for a booking
    const findConfirmationEmail = (bookingCreatedAt: string, serviceName?: string, bookingId?: string): EmailRecord | undefined => {
/*
       * ───────────────────────────────────────────────────────────────────────
       * THE WORDS A CONFIRMATION USES — AND NOT THE SERVICE NAME.
       *
       * Both subjects carry the service name:
       *
       *   confirmation  "הפגישה שלך אושרה - {service}"
       *   reschedule    "הפגישה נקבעה מחדש - {service}"
       *
       * So a test that accepts the service name accepts BOTH, and the node
       * titled "אישור הזמנה נשלח" showed the reschedule notice underneath it —
       * leaving the owner unable to tell whether the confirmation had ever been
       * sent.
       *
       * `אושרה` is in the list because the Hebrew confirmation never contained
       * `אישור`: before the exact link existed, Hebrew confirmations were being
       * found ONLY by the service-name clause. Removing that clause without
       * this word would have broken Hebrew detection altogether.
       * ───────────────────────────────────────────────────────────────────────
       */
      const saysConfirmed = (email: EmailRecord) => {
        const subject = email.subject.toLowerCase();
        return (
          subject.includes('confirm') ||   /* en "confirmed", es "confirmada" */
          subject.includes('אושרה') ||
          subject.includes('אישור')
        );
      };

      const isConfirmationSubject = (email: EmailRecord) =>
        saysConfirmed(email) ||
        email.subject.toLowerCase().includes('booking') ||
        /* The service name stays ONLY in the legacy time-window path below,
           where the five-minute window already pins which booking it is and
           this clause is just extra signal. */
        Boolean(serviceName && email.subject.toLowerCase().includes(serviceName.toLowerCase()));

      /*
       * ───────────────────────────────────────────────────────────────────────
       * THE RECORDED LINK FIRST, THE GUESS ONLY AS A FALLBACK
       *
       * `email_sends.booking_id` exists since 20261077. Where it is set this is
       * no longer a guess at all, and the subject test below is only used to
       * pick the CONFIRMATION out of that booking's mail rather than to decide
       * which booking it belonged to.
       *
       * The heuristic underneath — within five minutes of the booking being
       * created, and a subject that mentions confirmation or the service — is
       * kept for the 704 rows written before the column, which carry no link
       * and never will. It is also why the link was added: keyed on when the
       * BOOKING was created, it cannot tell two attempts of one booking apart,
       * so every mail attached to the first.
       * ───────────────────────────────────────────────────────────────────────
       */
      if (bookingId) {
        const linked = emails
          .filter(email => email.booking_id === bookingId)
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

        /* The confirmation if one is recognisable, else the first mail this
           booking ever sent — which on any booking the platform creates IS the
           confirmation. */
        /*
         * A linked mail that actually SAYS it is a confirmation. No
         * `?? linked[0]` fallback: "the first mail this booking sent is the
         * confirmation" only holds if the confirmation is linked, and on any
         * booking predating 20261077 it is not — so the fallback handed back
         * whatever the first LINKED mail happened to be, which here was the
         * reschedule notice.
         *
         * Falling through to the time window instead can still find the real
         * confirmation among the unlinked rows.
         */
        /*
         * ── A BILL IS NOT A CONFIRMATION, WHATEVER ITS SUBJECT SAYS ───────
         *
         * The invoice subject is `{noun} #{number} from {businessName}`, and
         * BOTH halves are the business's own words: the noun is whatever it
         * calls the document — "Receipt", "Tax invoice", "אישור תשלום" — and
         * the name is free text. So an invoice mail can contain `אישור` or
         * `confirm` and satisfy `saysConfirmed` while being a bill.
         *
         * It could not reach here before: invoice mail carried no booking, so
         * it never entered `linked` at all. Now that it does, the subject test
         * has to be told what it is reading. Excluded by KIND rather than by
         * subject, which is the rule this file already follows — see the note
         * on finding the cancellation by kind.
         */
        const confirmed = linked.find(
          email => email.email_kind !== 'invoice_sent' && saysConfirmed(email)
        );
        if (confirmed) return confirmed;

        /*
         * ───────────────────────────────────────────────────────────────────
         * THE RECEIPT IS THE CONFIRMATION, when it is the only mail there was.
         *
         * A dateless product bought through checkout gets a payment receipt and
         * no separate confirmation — there is no appointment to confirm, and the
         * receipt is what tells the client the purchase went through.
         *
         * Without this the step found nothing, and the code that builds it
         * ASSUMES a send when it has no record. So the card drew a green tick
         * reading "אישור הזמנה נשלח" and then "לא נרשמה שליחה" underneath: a
         * claim, and an admission that it has no evidence, in the same card.
         *
         * Last, after the real confirmation, so a scheduled booking that got
         * both is unaffected and still reports its confirmation.
         * ───────────────────────────────────────────────────────────────────
         */
        const receipt = linked.find(email => email.email_kind === 'payment_receipt');
        if (receipt) return receipt;
      }

      const bookingTime = new Date(bookingCreatedAt).getTime();
      const fiveMinutes = 5 * 60 * 1000;

      return emails.find(email => {
        const emailTime = new Date(email.created_at).getTime();
        const isNearBookingTime = Math.abs(emailTime - bookingTime) < fiveMinutes;
        return isNearBookingTime && isConfirmationSubject(email);
      });
    };

    const sessionCards: SessionCardData[] = bookingsData.bookings.map((booking: BookingWithService) => {
      const bookingData: Appointment = toAppointment(booking);
      /* The mail sent about each attempt — see `attachAttemptEmails`. */
      bookingData.attempts = attachAttemptEmails(bookingData.attempts, emails);

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

      /*
       * THE BOOKING SAYS WHETHER IT IS ON A PLAN. THE SERVICE ONLY SAYS HOW IT
       * IS MEANT TO BE SOLD.
       *
       * ─────────────────────────────────────────────────────────────────────────
       * This asked the service's CONFIGURATION alone, and so claimed a plan for
       * any booking of a service configured for one — whether or not a plan had
       * been created. The owner's own booking path did not create them, so a
       * ₪800 service sold as "2 × ₪400" was charged in full and displayed here
       * as ₪400: the card showed the instalment the owner expected while twice
       * that had left the client's account, and the refund offered followed the
       * card rather than the charge.
       *
       * `payment_plan_id` is written by both paths that genuinely create a plan
       * — `createBookingPaymentPlan` on the invoice path and
       * `bindPlanSubscription` on the Stripe one — so a booking that was billed
       * in full now correctly shows what was billed.
       * ─────────────────────────────────────────────────────────────────────────
       */
      /*
       * What actually arrived, before anything is projected. A booking can carry
       * money as a transaction, an invoice, or both.
       */
      const money = booking as SchedulingBooking & {
        invoice?: { amount?: number | null; paid_at?: string | null } | null;
        payments?: Array<{
          /* The charge's own id and what came back off it. The query has
             always selected both — `payments:payment_transactions(id, amount,
             refunded_amount, …)` — and only this local type left them out, so
             a period could not be matched to the refund on its own charge. */
          id?: string | null;
          refunded_amount?: number | string | null;
          amount?: number | null;
          status?: string | null;
          /* 'manual' when the owner recorded the money, not a processor. */
          processor_type?: string | null;
        }>;
        planPeriods?: Array<{
          id: string;
          installment_number: number;
          amount: number | string;
          currency?: string | null;
          status: string;
          trigger?: 'date' | 'manual' | null;
          due_date: string | null;
          paid_at?: string | null;
          invoice_id?: string | null;
          label?: string | null;
        }>;
      };

      /*
       * The plan's REAL periods, in order.
       *
       * A quoted job has shown its stages here all along — what each one is
       * worth, what has been paid, what falls due next. An instalment plan had
       * only "1 of 2" and a single figure, so the owner could not answer the
       * client's obvious question: when is the next payment, and how much?
       *
       * These are the rows the money is actually billed from
       * (`payment_plan_installments`), not a projection of the service's
       * configuration — so a period that has been paid, one that has been
       * invoiced and one still to come each read as what they are.
       */
      const planPeriods = [...(money.planPeriods ?? [])].sort(
        (a, b) => a.installment_number - b.installment_number
      );

      const collected =
        (money.payments ?? [])
          .filter(pay => transactionMoneyArrived(pay.status))
          .reduce((sum, pay) => sum + Number(pay.amount ?? 0), 0) ||
        (money.invoice?.paid_at ? Number(money.invoice.amount ?? 0) : 0);

      /* The plan this booking is on, built by the shared helper above so the
         other card builder cannot drift from it again. */
      const sessionPlan = buildSessionPlan({
        planPeriods,
        /* So a card-paid period can report its own refund — see `payments` on
           the input. Passed at BOTH call sites: the note above records that
           these two builders have already drifted once. */
        payments: money.payments,
        service: bookingWithService.service,
        servicePrice,
        serviceCurrency,
        collected,
      });

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
        /* Joined by the repository and, until now, never read here.
           `refunded_at` sits on the same row and is what dates a refund taken
           against a card payment that never had an invoice. */
        payments?: Array<{
          id: string;
          status: string;
          paid_at?: string | null;
          refunded_at?: string | null;
        }>;
      };
      const invoiceData = bookingWithInvoice.invoice;

      /*
       * WHEN THE MONEY ARRIVED — from whichever record actually holds it.
       *
       * This read `invoice.paid_at` alone. A booking paid through a TRANSACTION
       * with no invoice therefore had no date at all, so the payment step
       * carried no timestamp and `groupJourneyByDay` filed it with the steps
       * that have not happened yet. A payment already taken appeared under
       * "Upcoming".
       *
       * Both records hang off the booking and the payments tab reads both;
       * only this path did not, which is why the same money could be listed
       * there and undated here. Invoice first, because where both exist the
       * invoice is the document the client was actually sent.
       */
      const paidAtFromRecords =
        invoiceData?.paid_at ||
        bookingWithInvoice.payments?.find(pay => transactionMoneyArrived(pay.status) && pay.paid_at)?.paid_at ||
        undefined;

      /*
       * AND WHEN IT WENT BACK — from whichever record holds that, too.
       *
       * The same gap as `paid_at` above, left behind when that one was closed.
       * The refunded AMOUNT is read from `refunded_total`, which counts both
       * ways money attaches to a booking; the refunded DATE was read from
       * `invoice.refunded_at` alone. A booking paid by card through website
       * checkout raises no invoice, so the figure was known and the date was
       * not.
       *
       * That is not a cosmetic gap. The journey renders its refund line only
       * when BOTH are present (`refunded > 0 && payment.refundedAt`), so the
       * refund collapsed to a bare "returned" badge with no second row and no
       * date — the money came back and the card could not say when.
       *
       * Latest wins, for a booking returned in more than one go, and the
       * invoice still comes first where both exist: it is the document the
       * client was actually sent.
       */
      const refundedAtFromRecords =
        invoiceData?.refunded_at ||
        (bookingWithInvoice.payments ?? [])
          .map(pay => pay.refunded_at)
          .filter((at): at is string => Boolean(at))
          .sort()
          .pop() ||
        undefined;

      /*
       * A quoted job's money comes from the QUOTE, not the service.
       *
       * Checked before `isFreeService`, because a quoted service is priced 0 and
       * would otherwise be declared free — which is how "Manage payment" ended
       * up showing ₪0.00 and "no payment required" for a job with a paid deposit.
       */
      const quotedMoney = quotedPayment(
        isQuotedJob(bookingWithService) ? pickProposal(booking.id, proposalsList) : null,
        serviceCurrency
      );

      /*
       * A PACKAGE'S MEETING IS BILLED FOR ITSELF — see `packageSessionPayment`.
       *
       * Asked after the quote and BEFORE "is the service free", which is the
       * rung that was swallowing it: the service behind a quoted package is
       * priced 0, so a meeting with a paid ₪74.99 invoice read as free and the
       * row showed no money and offered no refund.
       */
      const sessionMoney = packageSessionPayment({
        parentBookingId: bookingData.parent_booking_id,
        paymentStatus: booking.payment_status,
        paymentId: booking.payment_id,
        currency: serviceCurrency,
        periods: planPeriods,
        invoice: invoiceData,
        refundedTotal: bookingWithInvoice.refunded_total,
        paidAt: paidAtFromRecords,
      });

      const manuallySettled = isManuallySettled(money.payments);

      const paymentData: SessionPayment | null = quotedMoney ? quotedMoney : sessionMoney ? sessionMoney : isFreeService ? {
        amount: 0,
        currency: serviceCurrency,
        status: 'free' as const
      } : servicePrice > 0 ? {
        id: booking.payment_id || undefined,
        isManual: manuallySettled,
        // One period for a plan, the whole price otherwise — what this payment
        // is, never what the agreement totals.
        amount: sessionPlan ? sessionPlan.installmentAmount : servicePrice,
        currency: serviceCurrency,
        status: mapPaymentStatus(booking.payment_status),
        plan: sessionPlan,
        paidAt: paidAtFromRecords,
        /*
         * The refund, across BOTH ways money attaches to a booking — the same
         * three fields `fetchSessions` sets. Without them the journey's payment
         * receipt has no refund to show and renders the charge alone.
         */
        refundedAmount: Number(bookingWithInvoice.refunded_total ?? 0) || undefined,
        /* From the transaction as well as the invoice — see
           `refundedAtFromRecords`. The amount above already counts both. */
        refundedAt: refundedAtFromRecords,
        invoicedAmount: Number(invoiceData?.amount ?? 0) || undefined,
        // Invoice data for resend functionality and due date display
        invoiceId: invoiceData?.id,
        invoiceStatus: invoiceData?.status as SessionPayment['invoiceStatus'],
        invoiceDueDate: invoiceData?.due_date || undefined,
        invoiceSentAt: invoiceData?.sent_at || undefined
      } : null;

      // Find confirmation email for this booking
      const confirmationEmail = findConfirmationEmail(booking.created_at, bookingWithService.service?.service_name, booking.id);

      return {
        booking: bookingData,
        payment: paymentData,
        journeySteps: buildJourneySteps(
          {
            booking: bookingData,
            payment: paymentData,
            /* The cancellation's own message, for the terminal node. */
            cancellationEmail: (() => {
              const found = findCancellationEmail(emails, booking.id);
              return found
                ? { id: found.id, subject: found.subject, status: found.status, sentAt: found.sent_at || found.created_at }
                : null;
            })(),
            confirmationEmail: confirmationEmail ? {
              status: confirmationEmail.status,
              sentAt: confirmationEmail.sent_at || confirmationEmail.created_at,
              deliveredAt: confirmationEmail.delivered_at || undefined,
              openedAt: confirmationEmail.opened_at || undefined,
              subject: confirmationEmail.subject
            } : undefined,
            proposal: isQuotedJob(bookingWithService)
              ? pickProposal(booking.id, proposalsList)
              : undefined,
            proposalHistory: isQuotedJob(bookingWithService)
              ? proposalsFor(booking.id, proposalsList)
              : undefined
          },
          language,
          collects,
          timezone
        )
      };
    });
    setSessions(foldPackageMeetings(sessionCards, proposalsList));
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
        /* `include_attempts`: every arranged appointment, not just the current
           one, so the journey can draw a row per attempt. See `listAttempts`. */
        const bookingsPromise = fetch(`/api/scheduling/bookings?contact_id=${contactId}&limit=50&include_attempts=true`)
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

        /*
         * THE INTAKE SETTING IS AWAITED HERE, not read from state.
         *
         * ─────────────────────────────────────────────────────────────────────
         * `collectsIntake` decides whether a booking shows an intake step at
         * all, and it arrives from its own fetch in its own effect. Read off
         * state, this load saw `false` every time: the closure was created when
         * the drawer opened, before any answer existed, and nothing rebuilds
         * the cards afterwards — the effect's deps are `[contact.id, isOpen]`.
         *
         * So the step was missing ON OPEN and appeared after any action that
         * called `fetchSessions`, which is recreated each render. That is the
         * same shape as the note on `processBookingsData` above, where a
         * refund showed only after a refresh.
         *
         * Awaiting it alongside the rest removes the ordering question
         * instead of winning it: there is no arrangement of these four
         * responses that can build the journey without the answer.
         * ─────────────────────────────────────────────────────────────────────
         */
        const intakeSettingsPromise = fetch('/api/intake/settings')
          .then(response => (response.ok ? response.json() : null))
          .then(data => businessCollectsIntake(data?.settings))
          /* A failed read leaves it false: a booking then shows no intake step,
             which is the safer of the two mistakes. */
          .catch(() => false);

        const [bookingsData, emailsData, proposalsList, collects] = await Promise.all([
          bookingsPromise,
          emailsPromise,
          proposalsPromise,
          intakeSettingsPromise,
        ]);

        /* Kept in step with the separate effect's own write, so whichever
           settles last, both readers agree. */
        collectsIntakeRef.current = collects;

        // Sessions need both: the cards carry the confirmation email.
        if (bookingsData.success && bookingsData.bookings) {
          processBookingsData(bookingsData, emailsData, proposalsList, collects);
        }
        setLoadingSessions(false);
      } catch (error) {
        logger.error({ err: error }, 'Failed to load priority data');
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
            // Double assertion for the index-signature gap described on the
            // state above; the route returns the seven day keys.
            setAvailability(data.availability as unknown as WeeklyAvailability);

            if (data.timezone) setBookingTimezone(data.timezone as string);
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
    /*
     * Keyed on the contact's IDENTITY, not on the object.
     *
     * Everything in this effect is drawer-OPENING work: seed the form, go back
     * to the first tab, clear any previous messages, load the tabs' data. That
     * is right when a different contact is shown, and wrong when the same
     * contact's row is merely replaced with a fresher copy — which is exactly
     * what happens after a save now that the parent re-points the drawer
     * instead of closing it.
     *
     * With `contact` in the deps, saving would have: thrown the owner back to
     * the Customer tab from wherever they were, cleared the "Saved" message the
     * save had just set, and re-fetched every tab's data — turning the reload
     * we removed from the page into a reload inside the drawer.
     *
     * The form does not need re-seeding on a same-id update: its values are
     * what was just submitted.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.id, isOpen]);

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
        /* The silent refresh asks for the same shape as the first load, or the
           journey would lose its attempt rows the moment anything reloaded. */
        fetch(`/api/scheduling/bookings?contact_id=${contactId}&limit=50&include_attempts=true`, { cache: 'no-store' }),
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
        /** What this mail was about (20261077). See the copy above. */
        booking_id?: string | null;
        meeting_id?: string | null;
        /** Whether it repeated earlier mail (20261079), and what kind it was
            (20261081). Both come down with the row; see the copy above. */
        is_resend?: boolean;
        email_kind?: string | null;
        subject: string;
        status: EmailSendStatus;
        sent_at: string | null;
        delivered_at: string | null;
        opened_at: string | null;
        created_at: string;
      }
      const emails: EmailRecord[] = emailsData.emails || [];

      // Helper to find confirmation email for a booking
      const findConfirmationEmail = (bookingCreatedAt: string, serviceName?: string, bookingId?: string): EmailRecord | undefined => {
        /* Both subjects carry the service name, so accepting it accepts the
           reschedule notice too — see the copy on the initial load. `אושרה`
           because the Hebrew confirmation never says `אישור`. */
        const saysConfirmed = (email: EmailRecord) => {
          const subject = email.subject.toLowerCase();
          return (
            subject.includes('confirm') ||
            subject.includes('אושרה') ||
            subject.includes('אישור')
          );
        };

        const isConfirmationSubject = (email: EmailRecord) =>
          saysConfirmed(email) ||
          email.subject.toLowerCase().includes('booking') ||
          Boolean(serviceName && email.subject.toLowerCase().includes(serviceName.toLowerCase()));

        /* The recorded link first — see the copy of this on the initial load
           for why the heuristic below is kept as the fallback. Both copies must
           behave identically: the first load and the silent refresh drawing the
           same booking differently is a bug that only shows after a refresh. */
        if (bookingId) {
          const linked = emails
            .filter(email => email.booking_id === bookingId)
            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

          /* No `?? linked[0]`: on a booking predating the link column the
             confirmation is unlinked, so that fallback returned whatever was
             linked — the reschedule notice. Fall through instead. */
          /* And a bill is not a confirmation whatever its subject says — the
             copy on the initial load carries the reasoning. Both copies must
             behave identically. */
          const confirmed = linked.find(
            email => email.email_kind !== 'invoice_sent' && saysConfirmed(email)
          );
          if (confirmed) return confirmed;

          /*
           * ───────────────────────────────────────────────────────────────────
           * THE RECEIPT IS THE CONFIRMATION, when it is the only mail there was.
           *
           * A dateless product bought through checkout gets a payment receipt and
           * no separate confirmation — there is no appointment to confirm, and the
           * receipt is what tells the client the purchase went through.
           *
           * Without this the step found nothing, and the code that builds it
           * ASSUMES a send when it has no record. So the card drew a green tick
           * reading "אישור הזמנה נשלח" and then "לא נרשמה שליחה" underneath: a
           * claim, and an admission that it has no evidence, in the same card.
           *
           * Last, after the real confirmation, so a scheduled booking that got
           * both is unaffected and still reports its confirmation.
           * ───────────────────────────────────────────────────────────────────
           */
          const receipt = linked.find(email => email.email_kind === 'payment_receipt');
          if (receipt) return receipt;
        }

        const bookingTime = new Date(bookingCreatedAt).getTime();
        const fiveMinutes = 5 * 60 * 1000;

        return emails.find(email => {
          const emailTime = new Date(email.created_at).getTime();
          const isNearBookingTime = Math.abs(emailTime - bookingTime) < fiveMinutes;
          return isNearBookingTime && isConfirmationSubject(email);
        });
      };

      if (bookingsData.success && bookingsData.bookings) {
        const sessionCards: SessionCardData[] = bookingsData.bookings.map((booking: BookingWithService) => {
          const bookingData: Appointment = toAppointment(booking);
          /* Same pairing as the initial load. Both or neither, or the journey
             loses its mail on the first silent refresh. */
          bookingData.attempts = attachAttemptEmails(bookingData.attempts, emails);

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
          const bookingMoney = booking as SchedulingBooking & {
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
            payments?: Array<{
              id: string;
              status: string;
              /* Selected by the query; declared here so this twin can answer
                 the same question the primary path does. */
              refunded_amount?: number | string | null;
              paid_at?: string | null;
              /* Needed to sum what has actually arrived. The query has always
                 selected it; only this local type left it out. */
              amount?: number | string | null;
              /* 'manual' when the owner recorded the money, not a processor. */
              processor_type?: string | null;
            }>;
            /* Embedded by the booking query, and the record of what each
               meeting of a package was sold for.
               Declared to match `findAll`'s select rather than the two fields
               `packageSessionPayment` happened to need: the narrower shape is
               why this builder could not assemble a plan from rows it already
               had. */
            planPeriods?: Array<{
              id: string;
              installment_number: number;
              amount: number | string;
              currency?: string | null;
              status: string;
              trigger?: 'date' | 'manual' | null;
              due_date: string | null;
              paid_at?: string | null;
              invoice_id?: string | null;
              transaction_id?: string | null;
              label?: string | null;
            }>;
          };
          const invoiceData = bookingMoney.invoice;

          // Same rule as the primary path above — see the note there.
          const paidAtFromRecords =
            invoiceData?.paid_at ||
            bookingMoney.payments?.find(pay => transactionMoneyArrived(pay.status) && pay.paid_at)?.paid_at ||
            undefined;

          /* And the refund's date, by the same rule. This builder is the twin
             of the one above and the two have drifted before, which is exactly
             what the note there warns about: the refunded AMOUNT already counts
             both ways money attaches, so reading the DATE off the invoice alone
             left a card refund dateless and its journey line unrendered. */
          const refundedAtFromRecords =
            invoiceData?.refunded_at ||
            (bookingMoney.payments ?? [])
              .map(pay => (pay as { refunded_at?: string | null }).refunded_at)
              .filter((at): at is string => Boolean(at))
              .sort()
              .pop() ||
            undefined;

          // Same rule as the primary path: the quote decides, not the service —
          // and a package's session is not a job a quote is still owed for.
          const quotedMoney = quotedPayment(
            isQuotedJob(booking as BookingWithService)
              ? pickProposal(booking.id, freshProposals)
              : null,
            serviceCurrency
          );

          // The meeting's own money, on the same rung as the primary path — see
          // the note there and in `packageSessionPayment`.
          const sessionMoney = packageSessionPayment({
            parentBookingId: bookingData.parent_booking_id,
            paymentStatus: booking.payment_status,
            paymentId: booking.payment_id,
            currency: serviceCurrency,
            periods: bookingMoney.planPeriods,
            invoice: invoiceData,
            refundedTotal: (booking as SchedulingBooking & { refunded_total?: number | string | null })
              .refunded_total,
            paidAt: paidAtFromRecords,
          });

          /*
           * THIS BOOKING'S PLAN, which this builder used to omit entirely.
           *
           * ───────────────────────────────────────────────────────────────────
           * The rows were already selected and already in scope — they are
           * handed to `packageSessionPayment` immediately above — and the
           * `paymentData` below simply did not carry them. So a plan booking
           * loaded through this path reached the card with no schedule, and the
           * card's no-schedule fallback invented a single stage worth the whole
           * price, marked paid off `payment_status`. ₪400 of ₪800 collected
           * displayed as ₪800 collected, ₪0 outstanding, with neither period
           * listed and no way to refund the one that had been paid.
           *
           * Same helper as the primary path, so the two cannot disagree again.
           * ───────────────────────────────────────────────────────────────────
           */
          const planPeriods = [...(bookingMoney.planPeriods ?? [])].sort(
            (a, b) => a.installment_number - b.installment_number
          );

          /* What has actually arrived. The transactions first — a plan's
             periods are charges, not invoices — then a paid invoice for the
             single-payment case. Identical to the primary path. */
          const collected =
            (bookingMoney.payments ?? [])
              .filter(pay => transactionMoneyArrived(pay.status))
              .reduce((sum, pay) => sum + Number(pay.amount ?? 0), 0) ||
            (invoiceData?.paid_at ? Number(invoiceData.amount ?? 0) : 0);

          const sessionPlan = buildSessionPlan({
            planPeriods,
            /* The twin of the call above; both must pass this. */
            payments: bookingMoney.payments,
            /* `?? undefined`: the join yields `null` for a booking whose service
               was deleted, and the helper's parameter is optional, not nullable. */
            service: booking.service ?? undefined,
            servicePrice,
            serviceCurrency,
            collected,
          });

              const manuallySettledHere = isManuallySettled(bookingMoney.payments);

      const paymentData: SessionPayment | null = quotedMoney ? quotedMoney : sessionMoney ? sessionMoney : isFreeService ? {
            amount: 0,
            currency: serviceCurrency,
            status: 'free' as const
          } : servicePrice > 0 ? {
            id: booking.payment_id || undefined,  // Payment ID for refunds
            isManual: manuallySettledHere,
            // One period for a plan, the whole price otherwise — what this
            // payment is, never what the agreement totals.
            amount: sessionPlan ? sessionPlan.installmentAmount : servicePrice,
            currency: serviceCurrency,
            status: mapPaymentStatus(booking.payment_status),
            plan: sessionPlan,
            paidAt: paidAtFromRecords,
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
            // a statement does. From the transaction as well as the invoice.
            refundedAt: refundedAtFromRecords,
            // What was billed, which is what the receipt should foot from.
            invoicedAmount: Number(invoiceData?.amount ?? 0) || undefined,
            // Invoice data for resend functionality and due date display
            invoiceId: invoiceData?.id,
            invoiceStatus: invoiceData?.status as SessionPayment['invoiceStatus'],
            invoiceDueDate: invoiceData?.due_date || undefined,
            invoiceSentAt: invoiceData?.sent_at || undefined
          } : null;

          // Find confirmation email for this booking
          const confirmationEmail = findConfirmationEmail(booking.created_at, booking.service?.service_name, booking.id);

          return {
            booking: bookingData,
            payment: paymentData,
            journeySteps: buildJourneySteps(
              {
                booking: bookingData,
                payment: paymentData,
                /* The cancellation's own message, for the terminal node. */
                cancellationEmail: (() => {
                  const found = findCancellationEmail(emails, booking.id);
                  return found
                    ? { id: found.id, subject: found.subject, status: found.status, sentAt: found.sent_at || found.created_at }
                    : null;
                })(),
                confirmationEmail: confirmationEmail ? {
                  status: confirmationEmail.status,
                  sentAt: confirmationEmail.sent_at || confirmationEmail.created_at,
                  deliveredAt: confirmationEmail.delivered_at || undefined,
                  openedAt: confirmationEmail.opened_at || undefined,
                  subject: confirmationEmail.subject
                } : undefined,
                proposal: isQuotedJob(booking as BookingWithService)
                  ? pickProposal(booking.id, freshProposals)
                  : undefined,
                proposalHistory: isQuotedJob(booking as BookingWithService)
                  ? proposalsFor(booking.id, freshProposals)
                  : undefined
              },
              language,
              collectsIntakeRef.current,
              timezone
            )
          };
        });
        // `freshProposals` on this path: it is the refetch's own list, and the
        // fold needs the same quotes the cards were built from.
        setSessions(foldPackageMeetings(sessionCards, freshProposals));
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
      logger.error({ err: error }, 'Failed to fetch sessions');
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
      logger.error({ err: error }, 'Failed to fetch activities');
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
      logger.error({ err: error }, 'Failed to fetch emails');
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
      logger.error({ err: error }, 'Failed to fetch tasks');
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
      logger.error({ err: error }, 'Failed to fetch documents');
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
      logger.error({ err: error }, 'Failed to fetch services');
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
      logger.error({ err: error }, 'Failed to fetch all bookings');
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
        /*
         * Hand back the saved row so the drawer stays open on it.
         *
         * The route answers with the updated contact; passing it lets the
         * parent refresh this record in place instead of closing the drawer
         * and re-fetching the list behind a full-page spinner.
         */
        onContactUpdated(data.contact ?? undefined);
      } else {
        setErrorMessage(data.error || t('crm.drawer.save_error'));
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to save contact');
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
      logger.error({ err: error }, 'Failed to auto-save notes');
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
      logger.error({ err: error }, 'Failed to create task');
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
      logger.error({ err: error }, 'Failed to toggle task');
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
      logger.error({ err: error }, 'Failed to delete task');
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
      logger.error({ err: error }, 'Failed to add activity');
    }
  };

  // Session handlers
  const handleNewSession = () => {
    // Open the modal immediately; the services fill in when they arrive.
    setEditingBooking(undefined);
    /* A new booking is not a session being moved. Left set, the next save
       would post to the last session's reschedule endpoint. */
    setReschedulingMeetingId(null);
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
    const session = findSession(bookingId);
    if (session) {
      /*
       * `everyBooking()` includes a package's sessions, so this id may be a
       * MEETING. The dialog is the same — it is a time picker either way — and
       * only where it saves differs.
       */
      setReschedulingMeetingId(session.booking.meeting_id ?? null);
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
    setReschedulingMeetingId(null);
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
        /*
         * A client who has paid cannot be deleted, and that is a decision rather
         * than a fault. The route says so with a code, because the sentence
         * itself has to arrive in the reader's own language — the server's is
         * English whatever the drawer is set to.
         */
        setErrorMessage(
          data.code === 'contact_holds_money'
            ? t('crm.drawer.delete_blocked_paid')
            : data.error || t('crm.drawer.delete_error')
        );
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to delete contact');
      setErrorMessage(t('crm.drawer.delete_error'));
    }
  };

  /**
   * Move this contact out of, or back into, the active pipeline.
   *
   * The footer used to offer Deactivate to everybody — including people who
   * were already deactivated, for whom pressing it moved them to the stage they
   * were already standing in and closed the drawer as though something had
   * happened. There was no way back short of picking a stage by hand.
   *
   * Which stage either direction means is resolved server-side by stage TYPE,
   * because every business names them differently.
   */
  const handleSetActive = async (nextActive: boolean) => {
    try {
      const response = await fetch(`/api/crm/contacts/${contact.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: nextActive })
      });

      const data = await response.json();
      if (data.success) {
        /*
         * Stays open on the contact, like every other field edit.
         *
         * Activating or deactivating moves a pipeline stage — it is a change TO
         * this contact, not a way of leaving it — and closing meant an owner who
         * reactivated someone in order to book them was put back in the list to
         * find them again.
         */
        onContactUpdated(data.contact ?? undefined);
      } else {
        setErrorMessage(data.error || t('crm.drawer.deactivate_error'));
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to deactivate contact');
      setErrorMessage(t('crm.drawer.deactivate_error'));
    }
  };

  // File upload handler
  /**
   * Put a file on a contact, without the file passing through our own server.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THE FILE USED TO BE BASE64'D INTO A JSON BODY AND POSTED HERE.
   *
   * A serverless request body is capped at 4.5MB by the platform, and base64
   * adds a third — so the real ceiling was about 3.3MB while the picker, the
   * route's schema and the bucket all said 50MB. A 4.47MB PDF was refused at
   * the EDGE, before any handler ran, so the reply was not JSON at all:
   * `response.json()` threw, the catch below ran, and the owner was shown "the
   * document could not be uploaded" with nothing in it to act on.
   *
   * Now the server only issues a signed URL — a few hundred bytes — and the
   * browser uploads to Storage directly. The platform is out of the file's
   * path, so the 50MB is real, and base64's 33% is gone with it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const handleFileUpload = async (file: File, docName: string, docType: string, description: string) => {
    try {
      setUploadingDocument(true);
      setErrorMessage('');

      /* 1. Permission to write one object, at one path this account owns. */
      const ticketResponse = await fetch(
        `/api/crm/contacts/${contact.id}/documents/upload-url`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_name: file.name,
            mime_type: file.type,
            file_size: file.size,
          }),
        }
      );

      const ticket = await ticketResponse.json();

      if (!ticketResponse.ok || !ticket.success) {
        setErrorMessage(ticket.error || t('crm.drawer.upload_error') || 'Failed to upload document');
        return;
      }

      /* 2. The file itself, browser to Storage. Nothing of ours in between. */
      const { error: storageError } = await supabase.storage
        .from(ticket.data.bucket)
        .uploadToSignedUrl(ticket.data.path, ticket.data.token, file, {
          contentType: file.type,
        });

      if (storageError) {
        logger.error({ err: storageError }, 'Direct upload to storage failed');
        setErrorMessage(t('crm.drawer.upload_error') || 'Failed to upload document');
        return;
      }

      /* 3. And the row, naming where it landed. */
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
          storage_path: ticket.data.path
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
      logger.error({ err: error }, 'Failed to upload document');
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
  /* `start_time` is null for a product purchase, which has no slot to be
     upcoming. It was passed to `new Date()` anyway — `new Date(null)` is the
     epoch, so products happened to fall out of the count by being dated 1970.
     Asked directly instead, which is the same answer for an honest reason. */
  const upcomingSessions = everyBooking().filter(s =>
    s.booking.status === 'confirmed' &&
    !!s.booking.start_time &&
    new Date(s.booking.start_time) > new Date()
  ).length;

  return (
    <>
      {/*
        ───────────────────────────────────────────────────────────────────────
        THIS DRAWER DISMISSED ITSELF WHILE SOMEONE WAS USING A DIALOG ABOVE IT.

        A Sheet is a Radix dialog and is modal by default, so a click INSIDE the
        configuration dialog counts as an interaction outside this one. Opening
        settings from the booking dialog — itself opened from here — therefore
        closed the drawer, which unmounted the booking with it. Everything typed
        into both was gone, and guarding the booking dialog alone could never
        have helped: the drawer was dismissing on its own account.

        The signal comes from the provider rather than from a prop, because this
        drawer cannot know what a dialog two levels down decided to open.
        ───────────────────────────────────────────────────────────────────────
      */}
      <Sheet
        open={isOpen}
        onOpenChange={(open) => {
          if (open) return;
          if (configurationOpen) return;
          onClose();
        }}
        modal={!configurationOpen}
      >
        <SheetContent
          side={isRTL ? 'left' : 'right'}
          className="w-full sm:max-w-xl p-0 bg-[var(--v2-bg)] border-[var(--v2-border)] overflow-hidden flex flex-col [&>button]:hidden"
          dir={isRTL ? 'rtl' : 'ltr'}
          onInteractOutside={event => {
            if (configurationOpen) event.preventDefault();
          }}
          onEscapeKeyDown={event => {
            if (configurationOpen) event.preventDefault();
          }}
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

          {/*
            Standing state, not a message.

            It sits above the transient success and error lines because it is a
            different kind of thing: those say what just happened, this says
            what is true until somebody changes it. Without it the only signal
            was the stage dropdown reading a word the owner chose themselves,
            which for a pipeline whose closing stage is called "הושלם" does not
            read as "inactive" at all.
          */}
          {contactInactive && (
            <div className="flex-shrink-0 mx-6 mt-4 p-3 bg-[var(--v2-border)]/40 border border-[var(--v2-border)] text-[var(--v2-text-secondary)] text-sm rounded-lg">
              {t('crm.contact.inactive_banner')}
            </div>
          )}

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
                // Read-only: what the chip is derived from and what the line
                // under it says. The drawer never writes it back.
                sourceMetadata={contact?.source_metadata as ContactSourceMetadata | null}
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
                focusBookingId={focusBookingId}
                /*
                 * Add a meeting to a package already under way. The money is the
                 * owner's answer — see the route — and it is only asked where it
                 * means anything, which `packageBillsPerMeeting` decides.
                 */
                onAddPackageMeeting={containerId => {
                  /*
                   * Billed per meeting when its stages are the meetings: each
                   * waiting on the owner and bound to a booking of its own.
                   * Read from the quote that sold it, which is what the drawer
                   * already has.
                   */
                  const sold = proposals.find(p => p.package_booking_id === containerId);

                  /*
                   * ───────────────────────────────────────────────────────────
                   * THE CARD FIRST, `allBookings` ONLY AS A FALLBACK.
                   *
                   * A package's purchase carries no clock, and `allBookings`
                   * is the diary — so the container could be absent from it
                   * entirely. With no container there was no `service_id`, the
                   * dialog opened on NO service at all, and the service step
                   * is locked while adding a meeting: the owner could neither
                   * be given one nor choose one.
                   *
                   * With no service the slot strip has nothing to ask about
                   * either, which is why the time step came up empty beneath
                   * it. One missing id, two blank steps.
                   *
                   * The drawer already holds this card — it is the row the
                   * button was pressed on.
                   * ───────────────────────────────────────────────────────────
                   */
                  /*
                   * ───────────────────────────────────────────────────────────
                   * THE CONTAINER MAY NOT BE A CARD AT ALL.
                   *
                   * `foldPackageMeetings` ABSORBS a package into the booking
                   * its quote came out of, when that booking is on screen —
                   * which is the whole point: one journey, with the sessions
                   * listed under the quote that sold them, rather than a
                   * purchase card sitting beside it saying the same thing.
                   *
                   * So looking the container up by id finds nothing for every
                   * package sold from a consultation, and this quote has one:
                   * `proposals.booking_id` points at the row the client's
                   * request created. Both symptoms came from here — no service
                   * to inherit, and no sessions to read the rhythm from, so
                   * the dialog opened blank on both counts.
                   *
                   * The host carries the sessions, and the package step on it
                   * names the container it is for.
                   * ───────────────────────────────────────────────────────────
                   */
                  const packageCard =
                    findSession(containerId) ??
                    sessions.find(card =>
                      card.journeySteps?.some(
                        step =>
                          step.key === 'package' &&
                          (step.metadata as { containerId?: string } | undefined)?.containerId ===
                            containerId
                      )
                    );
                  const container =
                    packageCard?.booking ?? allBookings.find(item => item.id === containerId);

                  /*
                   * WHERE THE SERIES SAYS THE NEXT ONE GOES.
                   *
                   * A course that runs every second Thursday at 09:30 runs
                   * every second Thursday at 09:30. Opening on "tomorrow, the
                   * next free hour" asked the owner to work out a date the
                   * agreement had already decided, and invited one that breaks
                   * the rhythm the client is planning around.
                   *
                   * Read off the meetings themselves, on the business's clock,
                   * because nothing records the spacing — see `nextInSeries`.
                   * A hand-adjusted series names no cadence and gets the
                   * dialog's own default instead of a guess.
                   */
                  /*
                   * The sessions as the card knows them, which is the only
                   * place they exist in the new shape: a package is one
                   * booking with N MEETINGS, so `parent_booking_id` matches
                   * nothing and the series read as having no rhythm at all —
                   * the dialog then offered "tomorrow" to a course that runs
                   * every Wednesday at 10:00.
                   *
                   * The old shape is still read beneath it, for a package sold
                   * before the split whose sessions really are child bookings.
                   */
                  const fromCard = (packageCard?.meetings ?? [])
                    .map(m => m.booking.start_time)
                    .filter((value): value is string => Boolean(value));

                  const meetings = (
                    fromCard.length > 0
                      ? fromCard
                      : allBookings
                          .filter(item => item.parent_booking_id === containerId && item.start_time)
                          .map(item => item.start_time as string)
                  ).map(startTime => toBusinessLocalInput(new Date(startTime), timezone));

                  /*
                   * And the dates the quote SOLD, as a second opinion.
                   *
                   * One rescheduled session is enough to put the diary off the
                   * pattern — moving the second meeting by a day made the gaps
                   * 15, 13, 14, 14 — and a series that names no rhythm got no
                   * proposed date at all. The agreement never moves, so it
                   * still knows the course is fortnightly.
                   */
                  const soldLocals = (sold?.sessions?.dates ?? [])
                    .map(iso => new Date(iso))
                    .filter(at => !Number.isNaN(at.getTime()))
                    .map(at => toBusinessLocalInput(at, timezone));

                  /*
                   * The next few, each asked of the series as it would stand
                   * with the one before it already added. Built by the same
                   * reader rather than by stepping a date here, so the chips
                   * and the field can never disagree about the rhythm — and so
                   * a monthly course keeps its anchor day.
                   */
                  const upcoming: string[] = [];
                  let running = meetings;

                  for (let i = 0; i < 6; i += 1) {
                    const next = nextInSeries(running, soldLocals);
                    if (!next) break;
                    upcoming.push(next);
                    running = [...running, next];
                  }

                  /*
                   * ── WHAT IS STILL WAITING TO BE MADE UP ─────────────────
                   *
                   * A session that was called off or missed and has nothing
                   * booked in its place. `was_replaced` is the recorded fact,
                   * written when the owner took the offer on the cancel or
                   * no-show dialog — not a count, which cannot tell a gap that
                   * has been made up from one that has not.
                   *
                   * Until now that offer was the ONLY place the fact could be
                   * stated, so a session added here instead left the missed
                   * one offering to be moved for the rest of the package's
                   * life. That is what this list exists to close.
                   */
                  const makeUpCandidates = (packageCard?.meetings ?? [])
                    .map(entry => entry.booking)
                    .filter(
                      row =>
                        (row.meeting_status === 'cancelled' ||
                          row.meeting_status === 'no_show') &&
                        !row.was_replaced &&
                        Boolean(row.meeting_id) &&
                        Boolean(row.start_time)
                    )
                    .sort((a, b) =>
                      String(a.start_time).localeCompare(String(b.start_time))
                    )
                    .map(row => ({
                      id: String(row.meeting_id),
                      /* The hour, on the business's clock, and what became of
                         it — "9 Dec, 10:00 · No Show". Two sessions of the
                         same package differ only by their date, so the date is
                         what has to be in the label. */
                      label: `${new Date(String(row.start_time)).toLocaleString(language, {
                        timeZone: timezone,
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })} · ${t(
                        row.meeting_status === 'no_show'
                          ? 'crm.booking.status.no_show'
                          : 'crm.booking.status.cancelled'
                      )}`,
                    }));

                  /* A fresh dialog asks the question fresh. */
                  setMakeUpForId(null);

                  setAddMeetingTo({
                    containerId,
                    makeUpCandidates,
                    /*
                     * THREE SOURCES, MOST AUTHORITATIVE LAST RESORT FIRST.
                     *
                     * The card's booking, then the diary, then the QUOTE —
                     * which is the thing that actually defines what this
                     * package sells, and the only one that cannot be missing
                     * for a package that exists.
                     *
                     * An empty id here is not a blank field, it is a dead end:
                     * the service step is locked while adding a meeting, so
                     * the owner can neither be given a service nor choose one,
                     * and the slot strip below has nothing to ask about.
                     */
                    serviceId: container?.service_id || sold?.service_id || '',
                    billsPerMeeting: Boolean(sold?.sessions?.bill_per_session),
                    nextLocal: upcoming[0] ?? null,
                    upcoming,
                    /*
                     * How long one of these runs. The quote that sold them is
                     * the only record of it — a package SERVICE keeps no
                     * duration, being bought rather than booked into an hour —
                     * and without it the slot strip asks for zero-minute slots
                     * and reports a week with nothing free in it.
                     */
                    sessionMinutes: Number(sold?.sessions?.duration_minutes) || null,
                  });
                  setChargeNewMeeting(false);
                  setEditingBooking(undefined);
                  setShowBookingModal(true);
                }}
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
                onStopQuote={(proposalId, proposalTitle) =>
                  setStopQuoteTarget({ id: proposalId, title: proposalTitle })
                }
                /*
                 * The same RefundModal a cancellation opens, not the payment
                 * manager. `originalAmount: 0` is only a placeholder — the modal
                 * asks the server what is actually refundable for this booking
                 * and `serverRemaining` overrides it, which is the whole reason
                 * a quoted job can be refunded without the caller knowing which
                 * stage invoice holds the money.
                 */
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
                /* Read the quote as it was sent. `supersedesId` names the version
                   to open on, not one to replace — `readOnly` is what decides
                   which of those it means. */
                onViewProposal={(bookingId, proposalId) => {
                  /*
                   * Carry the client's own words into the view.
                   *
                   * These were hardcoded null, so opening a DECLINED quote
                   * showed the terms and not the one thing worth reading: why
                   * it was refused. "We only have 8k budget" is the difference
                   * between re-quoting well and guessing, and it is written
                   * down in exactly one place.
                   */
                  const version = proposals.find(p => p.id === proposalId);

                  setProposalBuilder({
                    bookingId,
                    supersedesId: proposalId,
                    declineReason: version?.decline_reason ?? null,
                    declineNote: version?.decline_note ?? null,
                    readOnly: true,
                  });
                }}
                /* Confirmed, not fired from the row.
                   It bills the client — an accidental tap sends someone a real
                   invoice, and there is no undo that unsends an email. */
                onCompleteStage={(stageId, label, amount) =>
                  setPendingStage({ id: stageId, label, amount })
                }
                onRefundStage={setRefundStage}
                /* Record how the appointment went, from the card header.
                   Each outcome has its own endpoint — they are not interchangeable
                   writes to a status column: completing may settle money, a
                   cancellation notifies the client and frees the slot. */
                onSetBookingStatus={async (bookingId, status, meetingId, chargeable) => {
                  /* Carried into the dialogs below, which ask and then write. */
                  setPendingOutcomeMeetingId(meetingId ?? null);

                  /*
                   * ── WHAT THE DIALOG CAN OFFER, ASKED BEFORE IT OPENS ──────
                   *
                   * Only for a SESSION of a package — `meetingId` is what says
                   * so — and only for the two outcomes that free its place.
                   * Completing a session frees nothing, and an ordinary
                   * booking has no block to add to.
                   *
                   * `excluding` names the session being answered right now: it
                   * has not been written yet, so without it a block at its
                   * agreed size would report no room for the very replacement
                   * the owner is about to be offered.
                   *
                   * ── NOT AWAITED, AND THAT IS THE WHOLE POINT ─────────────
                   *
                   * This was awaited so the toggle would be present the
                   * instant the dialog appeared. The cost of that was the
                   * dialog itself: opening it waited on a network round trip,
                   * so pressing Cancel or No-show did nothing at all until the
                   * lookup came back — and against a route being compiled for
                   * the first time in dev, that is tens of seconds of a dead
                   * button.
                   *
                   * A dialog that opens late is a broken dialog. A toggle that
                   * arrives a moment after it is a toggle that arrives; it
                   * sits below the question the owner is reading, and the
                   * answer they came to give does not depend on it.
                   *
                   * So it is fired and forgotten. `setReplacementOffer(null)`
                   * above means a stale offer from the previous row can never
                   * be shown against this one, whatever order the replies
                   * land in.
                   */
                  setReplacementOffer(null);

                  if (meetingId && (status === 'cancelled' || status === 'no_show')) {
                    const forMeeting = meetingId;

                    void (async () => {
                      try {
                        const response = await fetch(
                          `/api/scheduling/bookings/${bookingId}/meetings?excluding=${encodeURIComponent(forMeeting)}`
                        );
                        const offer = await response.json();
                        if (offer?.success && offer.canAdd && offer.proposedStart) {
                          setReplacementOffer({
                            /*
                             * The PURCHASE, as the route resolved it — not the
                             * id sent to it. A package session's card carries
                             * the meeting's id in `booking.id`, so what goes
                             * out here is a meeting and what must come back is
                             * the container the replacement hangs off.
                             */
                            containerId: String(offer.containerId ?? bookingId),
                            proposedStart: String(offer.proposedStart),
                            options: Array.isArray(offer.proposedStarts)
                              ? offer.proposedStarts.map(String)
                              : [String(offer.proposedStart)],
                            billsPerSession: offer.billsPerSession === true,
                          });
                        }
                      } catch (err) {
                        logger.warn({ err, bookingId }, 'Could not look up a replacement session');
                      }
                    })();
                  }
                  /*
                   * Whether the no-show dialog offers the charge decision. The
                   * row knows, because it is the thing showing the stage.
                   */
                  setPendingOutcomeChargeable(Boolean(chargeable));

                  /*
                   * Cancelling reaches the CLIENT — it emails them and releases
                   * the slot — so it is confirmed rather than fired from a menu.
                   * The other two only record what happened.
                   */
                  /*
                   * ───────────────────────────────────────────────────────────
                   * CALLING OFF ONE SESSION IS NOT CANCELLING THE ORDER.
                   *
                   * A session went to the booking cancellation dialog, which
                   * asks "why is the ORDER cancelled?" and offers the reasons a
                   * JOB ends for: the client will not pay, the service is
                   * discontinued, the money was refunded and it is being closed
                   * out. None of them is a thing that happens to one hour of a
                   * package that is still running, and the client is nonetheless
                   * told their order was cancelled.
                   *
                   * `CancelMeetingDialog` is the one that calls off an
                   * appointment and leaves the work alone. `isQuoted: false`
                   * because a package's quote was accepted already — there is
                   * no quote still to come, so no toggle.
                   * ───────────────────────────────────────────────────────────
                   */
                  if (status === 'cancelled') {
                    if (meetingId) {
                      setPendingMeetingCancel({ bookingId, isQuoted: false, meetingId });
                    } else {
                      setPendingCancelBookingId(bookingId);
                    }
                    return;
                  }

                  /*
                   * A no-show is confirmed too. It is not a neutral record: it
                   * says this person did not turn up, it appears on their
                   * timeline, and the owner may want to invite them back — a
                   * choice only they can make, so it is asked for rather than
                   * assumed.
                   */
                  if (status === 'no_show') {
                    setPendingNoShowBookingId(bookingId);
                    return;
                  }

                  /*
                   * A SESSION is marked on the meeting, not the booking.
                   *
                   * Completing the container would claim all six sessions
                   * happened at once — and it is this call that bills the
                   * session, so it has to name which one.
                   */
                  try {
                    const response = await fetch(
                      meetingId
                        ? `/api/scheduling/meetings/${meetingId}/outcome`
                        : `/api/scheduling/bookings/${bookingId}/complete`,
                      {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(meetingId ? { status: 'held' } : {})
                      }
                    );
                    const data = await response.json();
                    if (!response.ok || data.success === false) {
                      throw new Error(data.error || 'Failed to update the booking');
                    }
                    /*
                     * Names what was RECORDED, not the row that changed.
                     *
                     * "ההזמנה עודכנה" is true of every write on this card, so it
                     * told the owner nothing — and on a quoted job it is also
                     * misleading: the booking is not completed, the CONSULTATION
                     * is, and the work has barely started. `status === 'completed'`
                     * is the only path that reaches here, cancel and no-show
                     * having returned above, so the message can be specific.
                     */
                    toast.success(t('crm.booking.meeting_marked_held') || 'Meeting marked as held');
                    fetchSessions(contact.id, { silent: true });
                    fetchActivities(contact.id, { silent: true });
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Failed to update the booking');
                  }
                }}
                onCancelMeeting={(bookingId, context) => {
                  /*
                   * ── IT ASKS NOW, AND IT HAS TO ──────────────────────────
                   *
                   * This fired straight away, on the reasoning that the client
                   * was party to the decision so there was nothing to confirm
                   * and nothing to send. Both halves turned out to be wrong:
                   * the owner can drop a meeting alone, the client is then
                   * holding a dead appointment, and the mail telling them has
                   * to say whether the quote is still coming.
                   *
                   * That last part is not derivable. "No proposal exists" is
                   * the same data whether one is being written or none ever
                   * will be, and the client reads an opposite message in the
                   * two cases. The dialog asks; the toggle only appears where
                   * there is a quote to continue.
                   */
                  setPendingMeetingCancel({ bookingId, isQuoted: context?.isQuoted ?? false });

                  /*
                   * ── THIS PATH ASKS FOR A REPLACEMENT TOO ──────────────────
                   *
                   * There are two ways into this dialog — the session row's
                   * outcome menu, and this button — and only the first was
                   * wired to look for a replacement. An owner who cancelled
                   * from here got the dialog with no toggle, which is the
                   * fault as reported.
                   *
                   * The id is passed as-is: the endpoint resolves a session's
                   * meeting id to its purchase itself, and answers "no offer"
                   * for an ordinary booking, which is the right answer there.
                   * Nothing to exclude, because this path does not name a
                   * session — the count is simply read as it stands.
                   */
                  setReplacementOffer(null);

                  void (async () => {
                    try {
                      const response = await fetch(
                        `/api/scheduling/bookings/${bookingId}/meetings`
                      );
                      const offer = await response.json();
                      if (offer?.success && offer.canAdd && offer.proposedStart) {
                        setReplacementOffer({
                          containerId: String(offer.containerId ?? bookingId),
                          proposedStart: String(offer.proposedStart),
                          options: Array.isArray(offer.proposedStarts)
                            ? offer.proposedStarts.map(String)
                            : [String(offer.proposedStart)],
                          billsPerSession: offer.billsPerSession === true,
                        });
                      }
                    } catch (err) {
                      logger.warn({ err, bookingId }, 'Could not look up a replacement session');
                    }
                  })();
                }}
                onResendMail={(bookingId, kind) => {
                  /* Confirm first — the same as the other two sends. The KIND
                     travels with it so the dialog sends back what the row
                     actually was, not always a confirmation. */
                  setPendingConfirmationBookingId(bookingId);
                  setPendingResendKind(kind);
                  setShowConfirmationResend(true);
                }}
                onSendInvoice={async (invoiceId, bookingId) => {
                  // Show confirmation dialog instead of sending directly
                  setPendingInvoiceId(invoiceId);
                  setPendingInvoiceBookingId(bookingId);
                  setShowInvoiceConfirm(true);
                }}
                onResendRefundEmail={invoiceId => {
                  // Confirm first — the same as every other send from here.
                  setPendingRefundInvoiceId(invoiceId);
                  setShowRefundEmailConfirm(true);
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

              {/* Marketing consent — why this person is or is not reachable.
                  Without it the send gate reads as the platform quietly not
                  working. */}
              <ConsentSection contactId={contact.id} isRTL={isRTL} />

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
                /*
                 * A URL this document can be VIEWED from.
                 *
                 * The LIST does not carry one — only the per-document route
                 * signs a URL, and it expires in an hour, so signing one for
                 * every row on every render would mint links for files nobody
                 * opens. Asked for at the moment the card is clicked instead.
                 */
                onPreviewDocument={async (docId) => {
                  try {
                    const response = await fetch(
                      `/api/crm/contacts/${contact.id}/documents/${docId}`
                    );
                    const data = await response.json();
                    return data?.success ? data.document?.download_url ?? null : null;
                  } catch (err) {
                    logger.error({ err, docId }, 'Could not get a preview URL');
                    return null;
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
                    logger.error({ err: error }, 'Failed to delete document');
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
                    {/*
                      One button, both directions. It said Deactivate to
                      everybody, including the contacts already sitting in the
                      past-client stage — so the only action offered on an
                      inactive person was to deactivate them again.
                    */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => (contactInactive ? handleSetActive(true) : setShowDeactivateConfirm(true))}
                      className={contactInactive
                        ? 'text-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/10'
                        : 'text-amber-500 hover:text-amber-600 hover:bg-amber-500/10'}
                    >
                      {contactInactive
                        ? <UserCheck className="h-4 w-4 me-1" />
                        : <UserX className="h-4 w-4 me-1" />}
                      {contactInactive
                        ? (t('crm.drawer.activate') || 'Activate')
                        : (t('crm.drawer.deactivate') || 'Deactivate')}
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
                    {/* `destructive` is not one of this Button's variants — the
                        union is default | outline | secondary | ghost | link —
                        so the prop was silently doing nothing and the confirm
                        button rendered in the default style. Coloured the same
                        way the deactivate confirm beside it is. */}
                    <Button size="sm" className="bg-red-500 hover:bg-red-600 text-white" onClick={handleDelete}>
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
                    <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white" onClick={() => handleSetActive(false)}>
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
        rescheduleMeetingId={reschedulingMeetingId}
        services={services}
        /*
         * NO STATUS ACTIONS IN HERE. This modal is reached from the drawer only
         * to change a TIME — the journey's "שנה מועד" — and the journey already
         * owns every other decision about the booking: the meeting stage has
         * held, no-show and reschedule; the card's footer has Cancel.
         *
         * Left on, its footer offered an owner who came to move an appointment
         * the chance to mark it held or delete it instead: the same decisions,
         * in a second place, under different words, with none of the journey's
         * guards around them.
         *
         * The header's calendar button opens the same component with no journey
         * underneath it, so it keeps them.
         */
        showStatusActions={false}
        isOpen={showBookingModal}
        onClose={() => {
          setShowBookingModal(false);
          setEditingBooking(undefined);
          setReschedulingMeetingId(null);
          setAddMeetingTo(null);
          /* Closed without adding: the answer dies with the dialog, so the
             next session is not quietly recorded as replacing this one. */
          setMakeUpForId(null);
        }}
        onBookingUpdated={() => {
          fetchSessions(contact.id, { silent: true });
          fetchActivities(contact.id, { silent: true });
          fetchAllBookings(); // Refresh all bookings for availability
          setShowBookingModal(false);
          setEditingBooking(undefined);
          setReschedulingMeetingId(null);
          /*
           * Now reported, where it used to be deliberately withheld.
           *
           * The note here said not to call this because it closed the drawer —
           * true at the time, and the cost was that the contact list kept
           * showing pre-booking data until something else happened to refresh
           * it. The parent no longer closes on an update, so the list can be
           * told. No argument: the contact row itself did not change.
           */
          onContactUpdated();
        }}
        availability={availability}
        timezone={bookingTimezone}
        prefilledContact={{
          id: contact.id,
          /* `PrefilledContact` wants these two non-null, and a CRM contact can
             have neither — a lead captured with only a phone number has no
             first name and no email. Empty string is what the modal's own
             inputs hold for "not given", so it prefills blank rather than
             refusing to open. */
          first_name: contact.first_name ?? '',
          last_name: contact.last_name,
          email: contact.email ?? '',
          phone: contact.phone
        }}
        existingBookings={allBookings}
        /*
         * CHOOSING AN HOUR FOR A PACKAGE'S NEXT MEETING.
         *
         * The dialog supplies what it knows — the service's hours, the days
         * the owner closed, the slots already sold — and writes nothing. The
         * meeting itself is created by the meetings endpoint, which is what
         * makes it a meeting OF this package rather than a standalone
         * appointment belonging to no purchase.
         */
        prefilledServiceId={addMeetingTo?.serviceId}
        sessionMinutes={addMeetingTo?.sessionMinutes}
        prefilledStartLocal={addMeetingTo?.nextLocal ?? undefined}
        /*
         * ───────────────────────────────────────────────────────────────────
         * NO "בחירה מהירה" CHIPS. Deliberately not passed.
         *
         * They were the series' own remaining dates offered as a row of
         * cards, from before the dialog could open ON the series date. It can
         * now: `prefilledStartLocal` lands the picker on the next one at the
         * same hour, so the chips repeated a choice already made — and they
         * rendered before the slots had loaded, so the dialog appeared in one
         * shape and rearranged itself into another a second later.
         *
         * The prop and its block are left intact rather than torn out: the
         * chips are a real feature for a caller that has dates the slot
         * endpoint cannot know, and passing them again is one line.
         * ───────────────────────────────────────────────────────────────────
         */
        extraToggle={
          addMeetingTo?.billsPerMeeting
            ? {
                label: t('crm.booking.package.charge_it'),
                checked: chargeNewMeeting,
                onChange: setChargeNewMeeting,
                /*
                 * Every other session of this package is charged, so leaving
                 * this off gives one away. That is a decision worth noticing
                 * before the dialog is saved — it was missed once, and the
                 * only way back is cancelling the session and adding it again.
                 */
                attention: true,
              }
            : undefined
        }
        /*
         * Asked only when there is something to ask about. A package with
         * nothing outstanding — the ordinary case, and every other caller of
         * this dialog — passes nothing and the footer is unchanged.
         */
        makeUpFor={
          addMeetingTo?.makeUpCandidates.length
            ? {
                label: t('crm.booking.package.makes_up_for'),
                noneLabel: t('crm.booking.package.makes_up_for_nothing'),
                options: addMeetingTo.makeUpCandidates.map(candidate => ({
                  value: candidate.id,
                  label: candidate.label,
                })),
                value: makeUpForId,
                onChange: setMakeUpForId,
              }
            : undefined
        }
        onPickSlot={
          addMeetingTo
            ? async (start, end) => {
                const response = await fetch(
                  `/api/scheduling/bookings/${addMeetingTo.containerId}/meetings`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      start_time: start.toISOString(),
                      /* The length the owner just saw and confirmed, rather
                         than the one the quote sold: the two can differ, and
                         the dialog is what they were looking at. */
                      duration_minutes: Math.max(
                        5,
                        Math.round((end.getTime() - start.getTime()) / 60_000)
                      ),
                      charge: chargeNewMeeting && addMeetingTo.billsPerMeeting,
                      /*
                       * Which missed session this one stands in for, when the
                       * owner said so. Omitted entirely otherwise, so a plain
                       * add sends exactly the body it always has.
                       *
                       * The route checks the id belongs to THIS container
                       * before writing it, so a stale one from a dialog left
                       * open is ignored rather than failing the add.
                       */
                      ...(makeUpForId ? { replaces: makeUpForId } : {}),
                    }),
                  }
                );

                const data = await response.json();

                if (!response.ok || !data.success) {
                  /* Thrown, not swallowed: the dialog shows the server's own
                     words, and "that hour is taken" is the whole point of
                     having opened it. */
                  throw new Error(data.error || t('crm.booking.package.add_failed'));
                }

                /*
                 * ───────────────────────────────────────────────────────────
                 * CLOSE FIRST, THEN REFRESH.
                 *
                 * The dialog closes when this promise resolves — and it used
                 * to resolve only after three refreshes had come back. So it
                 * sat open through all of them, and if any one threw it never
                 * closed at all: an error on screen about a meeting the server
                 * had already created, which the owner would then add again.
                 *
                 * The session exists the moment the response says so. Nothing
                 * about the refreshes is the dialog's business, and the drawer
                 * behind it updates whenever they land.
                 * ───────────────────────────────────────────────────────────
                 */
                setAddMeetingTo(null);
                /* Answered and written; the next dialog asks again. */
                setMakeUpForId(null);
                setShowBookingModal(false);

                void fetchSessions(contact.id, { silent: true });
                void fetchActivities(contact.id, { silent: true });
                void fetchAllBookings();
              }
            : undefined
        }
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
                .replace('{name}', contact.first_name || '')}
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
                .replace('{name}', contact.first_name || '')}
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
                  /* The journey's intake step reads `intake_sent_at` off the
                     booking, and the mail itself lands on the rail. Both come
                     from `sessions`, so refreshing only activities left the
                     step still reading "not sent yet" after it was. */
                  fetchSessions(contact.id, { silent: true });
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

      {/* Stopping an accepted job: the money and the job, in one press.
          Mounted out here for the same reason the builder is — the section can
          collapse underneath it. */}
      <StopQuoteDialog
        proposalId={stopQuoteTarget?.id ?? null}
        proposalTitle={stopQuoteTarget?.title ?? null}
        onClose={() => setStopQuoteTarget(null)}
        onStopped={() => {
          /*
           * Both, and silently.
           *
           * The journey reads the quote's status and the payment rows, and one
           * press changed both — refreshing only sessions would leave the strip
           * showing "accepted" beside stages that are now cancelled.
           */
          fetchSessions(contact.id, { silent: true });
          fetchActivities(contact.id, { silent: true });

          /*
           * AND NOTHING ELSE. It used to open the refund dialog from here.
           *
           * ───────────────────────────────────────────────────────────────────
           * Stopping a job and returning money are two decisions, and only the
           * first has been made. An owner who stops a job half-delivered may owe
           * nothing, may owe part, or may owe all of it — that is a judgement
           * about the work, not something that follows from the stop.
           *
           * It was worse than merely premature on a job with several payments:
           * the dialog it opened was addressed to the BOOKING, so it resolved
           * every settled payment and refused a partial outright. The owner was
           * pushed, at the moment of stopping, into an all-or-nothing refund of
           * the whole job — the opposite of deciding what to return.
           *
           * The decision now has its own door: each paid milestone carries its
           * own refund on its row, where a partial is meaningful because there
           * is one charge for it to come off.
           * ───────────────────────────────────────────────────────────────────
           */
        }}
      />

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
            /*
             * In VIEW mode the quote being read is the one to open on; in revise
             * mode it is the one being replaced. They are the same row either
             * way, which is why one prop serves both.
             */
            basedOn={proposals.find(p => p.id === proposalBuilder.supersedesId) ?? null}
            readOnly={proposalBuilder.readOnly ?? false}
            declineReason={proposalBuilder.declineReason}
            declineNote={proposalBuilder.declineNote}
            /*
             * ── OFFER THE TICK ONLY WHERE THERE IS SOMETHING TO CLOSE ───────
             * The meeting must have HAPPENED (its time has passed) and nobody
             * must have said what happened. A meeting still ahead has nothing
             * to mark, and one already answered would be asked twice.
             */
            offerMarkHeld={(() => {
              const b = session?.booking;
              if (!b?.start_time) return false;          // bought, not booked
              if (b.meeting_status) return false;         // already answered
              return new Date(b.start_time).getTime() <= Date.now();
            })()}
            onMarkHeld={async () => {
              const bookingId = proposalBuilder.bookingId;
              if (!bookingId) return;
              /*
               * The same endpoint the "mark as held" button uses, so there is
               * one way to record attendance. It writes `meeting_status` only:
               * the job stays open, which is what lets a quote follow it.
               */
              const response = await fetch(
                `/api/scheduling/bookings/${bookingId}/complete`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({}),
                }
              );
              const data = await response.json();
              if (!response.ok || data.success === false) {
                throw new Error(data.error || 'Could not mark the meeting as held');
              }
            }}
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
      />

      {/*
        No-show confirmation, and the choice of whether to invite the client
        back. Placed beside the cancellation dialog it mirrors.
      */}
      <NoShowConfirmDialog
        open={!!pendingNoShowBookingId}
        onOpenChange={open => !open && setPendingNoShowBookingId(null)}
        clientName={[contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || null}
        /*
         * Ask about the money only where there is money still to decide: a
         * session carrying an unbilled stage. The row said so when it opened
         * this dialog.
         */
        chargeable={Boolean(pendingOutcomeMeetingId) && pendingOutcomeChargeable}
        /* Only for a session of a package — see `replacementOffer`. */
        replacement={
          replacementOffer && pendingOutcomeMeetingId
            ? {
                proposedStart: replacementOffer.proposedStart,
                options: replacementOffer.options,
              }
            : null
        }
        onConfirm={async ({ notifyClient, chargeSession, addReplacement, replacementStart }) => {
          if (!pendingNoShowBookingId) return;

          try {
            /*
             * A package session is marked on the MEETING. `notifyClient` is
             * carried through either way, and the session's endpoint names the
             * session's own hour in the mail — the purchase has no clock, so
             * without that the client would be told about 1970.
             *
             * `chargeSession` goes only to the session endpoint, and only when
             * there was something to ask: the booking route has no per-session
             * stage to bill or waive, and sending it there would imply a
             * decision that surface cannot act on.
             */
            /*
             * The make-up goes in FIRST, and silently — the same ordering the
             * cancellation uses and for the same reason: the missed-appointment
             * mail lists every session of the block, and a make-up booked after
             * it is absent from the one list the client reads.
             *
             * It carries no money. A missed session keeps its portion, so the
             * replacement's row shows no figure — which is the truth, and what
             * makes this the owner's gift rather than an accounting move.
             */
            /*
             * The hour that makes up for the missed one, named so the mail can
             * say which it is. Null unless the booking actually landed — an
             * hour that failed to book must never be announced.
             */
            let madeUpWith: string | null = null;

            if (addReplacement && replacementOffer) {
              /* Never billed: the missed hour was held, and the owner has
                 already answered the money question on this dialog. */
              /*
               * The hour the owner SETTLED on, which is the proposal unless
               * they picked another from the dialog. Booking
               * `proposedStart` regardless made the picker decorative: it
               * moved the highlight and changed nothing.
               */
              const takes = replacementStart || replacementOffer.proposedStart;
              const madeUp = await bookReplacement(
                replacementOffer.containerId,
                takes,
                false,
                pendingOutcomeMeetingId
              );

              if (madeUp) madeUpWith = takes;
            }

            const response = await fetch(
              pendingOutcomeMeetingId
                ? `/api/scheduling/meetings/${pendingOutcomeMeetingId}/outcome`
                : `/api/scheduling/bookings/${pendingNoShowBookingId}/no-show`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                  pendingOutcomeMeetingId
                    ? {
                        status: 'no_show',
                        /*
                         * A booked make-up is told to the client whatever the
                         * invite toggle says. The two are alternatives — taking
                         * this one puts that one down — so without this, adding
                         * a make-up would book an hour and tell nobody.
                         */
                        notifyClient: notifyClient || Boolean(madeUpWith),
                        ...(pendingOutcomeChargeable ? { chargeSession } : {}),
                        ...(madeUpWith ? { replacementStart: madeUpWith } : {}),
                      }
                    : { notifyClient }
                ),
              }
            );
            const data = await response.json();
            if (!response.ok || data.success === false) {
              throw new Error(data.error || 'Failed to update the booking');
            }

            toast.success(t('crm.booking.no_show_marked') || 'Marked as a no-show');
            fetchSessions(contact.id, { silent: true });
            // The no-show now writes a row on the timeline, so refresh it too.
            fetchActivities(contact.id, { silent: true });
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to update the booking');
          } finally {
            setPendingNoShowBookingId(null);
            setPendingOutcomeMeetingId(null);
            setReplacementOffer(null);
            /* Cleared with the rest, so the next row's dialog cannot inherit a
               charge question from a session that had one. */
            setPendingOutcomeChargeable(false);
          }
        }}
      />

      {/* Booking Cancellation Confirmation */}
      <Dialog
        open={!!pendingCancelBookingId}
        onOpenChange={open => {
          if (open) return;
          setPendingCancelBookingId(null);
          setPendingOutcomeMeetingId(null);
        }}
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
                const pending = findSession(pendingCancelBookingId ?? '');
                // No start time is the same test the rest of the drawer uses.
                const hasSchedule = Boolean(pending?.booking.start_time);

                return (hasSchedule
                  ? t('crm.booking.cancel_message') ||
                    '{name} will be told the appointment is cancelled and the slot will be freed.'
                  : t('crm.booking.cancel_message_unscheduled')
                ).replace('{name}', contact.first_name || '');
              })()}
            </p>

            <div className="mt-4">
              <label className="block text-[13px] font-medium text-[var(--v2-text-secondary)] mb-1.5 rtl:text-right">
                {t('crm.booking.cancel_reason_label') || 'Why is it being cancelled?'}
                <span className="text-[#B42318]"> *</span>
              </label>
              {/* A dropdown here, radios on the client's page: this list is
                  fourteen items and the client's is six. Fourteen radios is a
                  scrolling wall inside a confirm dialog. */}
              <Select
                value={cancelReasonCode}
                onValueChange={value => setCancelReasonCode(value as OwnerCancelReason)}
              >
                <SelectTrigger className="w-full bg-[var(--v2-surface)] border-[var(--v2-border)] text-[var(--v2-text-primary)]">
                  <SelectValue
                    placeholder={t('cancel.choose_reason') || 'Choose a reason'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {OWNER_CANCEL_REASONS.map(code => (
                    <SelectItem key={code} value={code}>
                      {t(cancelReasonKey(code)) || code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Textarea
                value={cancelReasonNote}
                onChange={e => setCancelReasonNote(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder={t('crm.booking.cancel_note_placeholder') || 'Anything worth remembering (optional)'}
                className="mt-2 bg-[var(--v2-surface)] border-[var(--v2-border)] text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)]"
              />

              {/* The note is emailed to the client verbatim unless this is
                  ticked. Shown only once something has been typed — an empty
                  note has nothing to keep private. */}
              {cancelReasonNote.trim().length > 0 && (
                <div className="mt-2 rounded-lg border border-[var(--v2-border)]">
                  <SwitchRow
                    checked={!shareCancelNote}
                    onChange={next => setShareCancelNote(!next)}
                    isRTL={isRTL}
                    icon={<EyeOff className="h-3.5 w-3.5 text-[#B54708]" />}
                    label={t('cancel.hide_note_label') || 'Keep this note private, do not email it to the client'}
                  />
                </div>
              )}
            </div>
          </div>
          <div className={`flex gap-3 ${isRTL ? 'flex-row-reverse' : ''}`}>
            <Button
              variant="outline"
              onClick={() => {
                setPendingCancelBookingId(null);
                setCancelReasonCode('');
                setCancelReasonNote('');
                setShareCancelNote(true);
              }}
              disabled={cancellingBooking}
            >
              {t('common.cancel') || 'Cancel'}
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              // Mandatory: unreachable without a reason.
              disabled={cancellingBooking || !cancelReasonCode}
              onClick={async () => {
                if (!pendingCancelBookingId || !cancelReasonCode) return;
                setCancellingBooking(true);
                try {
                  /*
                   * Calling off ONE SESSION of a package goes to the meeting:
                   * cancelling the container would call off all six, and the
                   * money held against the others with it.
                   *
                   * The note is shared with the client only when the owner
                   * said so, which is the same choice the booking route makes.
                   */
                  const response = await fetch(
                    pendingOutcomeMeetingId
                      ? `/api/scheduling/meetings/${pendingOutcomeMeetingId}/outcome`
                      : `/api/scheduling/bookings/${pendingCancelBookingId}/cancel`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(
                        pendingOutcomeMeetingId
                          ? {
                              status: 'cancelled',
                              notifyClient: true,
                              reason: shareCancelNote ? cancelReasonNote.trim() || undefined : undefined
                            }
                          : {
                              reason_code: cancelReasonCode,
                              reason: cancelReasonNote.trim() || undefined,
                              share_note_with_client: shareCancelNote
                            }
                      )
                    }
                  );
                  const data = await response.json();
                  if (!response.ok || data.success === false) {
                    throw new Error(data.error || 'Failed to cancel the booking');
                  }
                  toast.success(t('crm.booking.cancelled_done') || 'Booking cancelled');
                  fetchSessions(contact.id, { silent: true });
                  fetchActivities(contact.id, { silent: true });

                  /*
                   * Ask about the money, if any is held.
                   *
                   * Derived server-side from the INVOICES rather than from
                   * `booking.payment_status`, which the delete guard already
                   * documents as untrustworthy. Zero is the ordinary case and
                   * says nothing.
                   */
                  const held = Number(data.amount_held) || 0;
                  /*
                   * A plan still charging opens the dialog even with nothing
                   * held: the appointment is off and the client's card is
                   * debited again next period until somebody decides
                   * otherwise, and the dialog is where that decision lives.
                   */
                  const planLive = data.plan_live === true;
                  const cancelledId = pendingCancelBookingId;
                  setPendingCancelBookingId(null);
                  if ((held > 0 || planLive) && cancelledId) {
                    setRefundAfterCancel({
                      bookingId: cancelledId,
                      amount: held,
                      currency: data.held_currency || '',
                    });
                  }
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

      {/*
        The money the cancellation deliberately did not touch.

        Opens straight after the booking is cancelled, and only when something
        is actually held. The dialog is the one every other refund surface uses,
        so the amount, the partial option and the client email all behave the
        way they do everywhere else — this is a prompt at the right moment, not
        a second way to refund.
      */}
      {/*
        ONE MILESTONE'S REFUND.
        ──────────────────────
        The same dialog every refund opens, addressed to this stage's invoice
        rather than to the booking — which is the whole difference. On a booking
        it would resolve every settled payment and refuse a partial; on an
        invoice it resolves one, and a partial is meaningful again because there
        is only one charge for it to come off.

        `alreadyRefunded` is what this stage has already returned, so the
        dialog's maximum is what is genuinely left on it. The server checks the
        same figure and is the authority; this stops the dialog OPENING with a
        number the server will refuse.
      */}
      {refundStage && (
        <RefundModal
          isOpen
          onClose={() => setRefundStage(null)}
          invoiceId={refundStage.invoiceId ?? undefined}
          /* An instalment period's money is a processor charge, not an invoice.
             The dialog asks the server what is refundable by whichever key it
             is given. */
          transactionId={refundStage.transactionId ?? undefined}
          originalAmount={refundStage.amount}
          alreadyRefunded={refundStage.refunded}
          currency={refundStage.currency}
          contactName={contact.first_name || undefined}
          isRTL={isRTL}
          onSuccess={() => {
            setRefundStage(null);
            /* The stage's own row, the strip above it and the journey all read
               this money. Refetched together so none of them is left showing
               what it was worth a moment ago. */
            fetchSessions(contact.id, { silent: true });
            fetchActivities(contact.id, { silent: true });
          }}
          onError={message => toast.error(message)}
        />
      )}

      {refundAfterCancel && (
        <RefundModal
          isOpen
          onClose={() => setRefundAfterCancel(null)}
          bookingId={refundAfterCancel.bookingId}
          originalAmount={refundAfterCancel.amount}
          currency={refundAfterCancel.currency}
          contactName={contact.first_name || undefined}
          isRTL={isRTL}
          onSuccess={() => {
            setRefundAfterCancel(null);
            // The booking's payment state and the timeline both moved.
            fetchSessions(contact.id, { silent: true });
            fetchActivities(contact.id, { silent: true });
          }}
          onError={message => toast.error(message)}
        />
      )}

      {/* Booking Confirmation Resend Dialog */}
      <CancelMeetingDialog
        open={pendingMeetingCancel !== null}
        onOpenChange={next => !next && setPendingMeetingCancel(null)}
        clientName={`${contact.first_name} ${contact.last_name || ''}`.trim() || null}
        isQuoted={pendingMeetingCancel?.isQuoted ?? false}
        /*
         * The OFFER is the gate, nothing else.
         *
         * This also required `pendingMeetingCancel.meetingId`, which only one
         * of the two ways into this dialog sets — so a cancellation started
         * from the card's own button could never show the toggle even with an
         * offer in hand. The offer already proves what that test was reaching
         * for: the endpoint returns one only for a session of a package with
         * room for another, and `setReplacementOffer(null)` on every open
         * means a stale one cannot survive into the next dialog.
         */
        replacement={
          replacementOffer
            ? {
                proposedStart: replacementOffer.proposedStart,
                options: replacementOffer.options,
              }
            : null
        }
        onConfirm={async ({ proposalContinues, addReplacement, replacementStart }) => {
          const bookingId = pendingMeetingCancel?.bookingId;
          if (!bookingId) return;
          const meetingId = pendingMeetingCancel?.meetingId ?? null;
          try {
            /*
             * ── THE REPLACEMENT GOES IN FIRST, AND SILENTLY ────────────────
             *
             * Ordering, not preference. The cancellation mail carries every
             * session of the block with its state and its share of the
             * payment, built when the route runs — so a replacement booked
             * afterwards is missing from the list the client actually reads,
             * and arrives instead as a second mail about a session appearing
             * from nowhere.
             *
             * Booked first, the one mail that follows says the whole thing:
             * this hour is off, this one replaces it, here is what each is
             * worth.
             *
             * If it fails, the cancellation still goes ahead — `bookReplacement`
             * reports and returns false. An owner who sees that can place the
             * session by hand; a cancellation blocked by a diary clash would
             * be the worse outcome by far.
             */
            /*
             * Whether a replacement actually landed, so the mail below can say
             * so. A booking that FAILED must not be announced — the client
             * would be told about an hour that does not exist.
             */
            let replacedWith: string | null = null;

            if (addReplacement && replacementOffer) {
              /*
               * Billed only on a PER-SESSION block, where the cancelled hour
               * was never paid for — those are invoiced when held. On an
               * upfront block the money is already in and the portion simply
               * moves across.
               */
              /*
               * The hour the owner SETTLED on, which is the proposal unless
               * they picked another from the dialog. Booking
               * `proposedStart` regardless made the picker decorative: it
               * moved the highlight and changed nothing.
               */
              const takes = replacementStart || replacementOffer.proposedStart;
              const booked = await bookReplacement(
                replacementOffer.containerId,
                takes,
                replacementOffer.billsPerSession,
                meetingId ?? null
              );

              if (booked) replacedWith = takes;
            }

            /*
             * A SESSION is called off on the meeting: the booking is the
             * purchase, and `meeting-cancel` would stamp the whole package's
             * mirror as though its one appointment were off. The session's own
             * endpoint stamps that hour, puts it back on sale, tells the client
             * naming THAT hour, and leaves the other five alone.
             *
             * `proposalContinues` is not asked of a package — its quote was
             * accepted already — so the dialog shows no toggle and there is
             * nothing to send.
             */
            const response = await fetch(
              meetingId
                ? `/api/scheduling/meetings/${meetingId}/outcome`
                : `/api/scheduling/bookings/${bookingId}/meeting-cancel`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                /* The owner's answer, which decides what the client reads. */
                body: JSON.stringify(
                  meetingId
                    ? {
                        status: 'cancelled',
                        notifyClient: true,
                        /* Named only when one was really booked, so the mail
                           explains the new date in the list rather than
                           leaving the client to infer it. */
                        ...(replacedWith ? { replacementStart: replacedWith } : {}),
                      }
                    : { proposalContinues }
                ),
              }
            );
            const data = await response.json();
            if (!response.ok || data.success === false) {
              throw new Error(data.error || 'Could not cancel the meeting');
            }
            /* Names what was recorded, like the sibling handlers: the MEETING
               is off, and the owner needs to see that the work was not also
               ended. */
            /*
             * ── IT CANNOT PROMISE THE WORK CONTINUES ──────────────────────
             * This read "the appointment is off, the work continues", which
             * was true of every meeting cancellation until the dialog started
             * asking. An owner who has just answered that no quote is coming
             * gets told the opposite of what they chose, and of what the
             * client was emailed a second earlier.
             *
             * It also names the send, because the client being told is the
             * part the owner cannot otherwise see from this card.
             */
            /*
             * ── AND IT MUST NOT PROMISE A SEND THAT DID NOT HAPPEN ────────
             *
             * Both toasts state "the client has been told" as a fact, and
             * until now neither route could contradict them: the send was
             * detached or its result discarded, so the response said
             * `success: true` whether or not any mail went out. Measured on
             * this account, two of five owner-cancelled meetings produced no
             * client email AND no `email_sends` row — the owner read "the
             * client has been told", the journey showed nothing, and there
             * was nothing to re-send.
             *
             * `clientNotified` is now returned by both routes: null when no
             * mail was due, false when one was due and did not go. Only false
             * changes what the owner reads — an older route that does not send
             * the field leaves the message exactly as it was.
             */
            setReplacementOffer(null);

            if (data.clientNotified === false) {
              toast.warning(
                t('crm.booking.meeting_cancelled_unsent') ||
                  'The meeting is off, but the client could not be emailed. Use Resend to try again.'
              );
            } else {
              toast.success(
                proposalContinues
                  ? t('crm.booking.meeting_cancelled_done') ||
                      'The meeting is off and the client has been told. The work continues.'
                  : t('crm.booking.meeting_cancelled_no_quote') ||
                      'The meeting is off. The client has been told that no quote will follow.'
              );
            }
            /* The same silent pair the other outcomes use, so the card updates
               in place instead of closing the drawer. */
            fetchSessions(contact.id, { silent: true });
            fetchActivities(contact.id, { silent: true });
            setPendingMeetingCancel(null);

            /*
             * ── AND AGAIN, ONCE THE MAIL HAS LANDED ─────────────────────
             *
             * The route sends the client's email NON-BLOCKING, deliberately:
             * the appointment is already cancelled and a slow mail server must
             * not hold up a response the owner is waiting on. The consequence
             * is that the response arrives before the `email_sends` row does —
             * measured at about nine seconds on a real send — so the refresh
             * above paints a rail with the cancellation on it and no notice
             * beneath, and the owner reads that as the client not being told.
             *
             * One more read, late enough to clear a normal send. It is silent
             * and idempotent, so the worst case is a refetch that changes
             * nothing.
             */
            window.setTimeout(() => {
              fetchSessions(contact.id, { silent: true });
            }, 8000);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not cancel the meeting');
          }
        }}
      />

      <Dialog open={showConfirmationResend} onOpenChange={setShowConfirmationResend}>
        <DialogContent className="sm:max-w-md" dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>
              {/* ── IT NAMES THE MESSAGE, NOT ALWAYS "THE CONFIRMATION" ──
                  The link now sends whatever kind it sits on, so a dialog
                  saying "send the appointment confirmation again" would be
                  describing something other than what the button does — the
                  exact mismatch the link itself had. */}
              {t('crm.booking.resend_title') || 'Send this message again'}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-[var(--v2-text-secondary)]">
              {(t('crm.booking.resend_message') ||
                'Send {what} to {name} again?')
                .replace(
                  '{what}',
                  /* The same wording the rail uses for that kind, so the
                     dialog and the row the owner just clicked agree. Falls
                     back to a neutral phrase for a kind with no label rather
                     than printing an identifier. */
                  translated(t, `crm.journey.mail_kind.${pendingResendKind}`) ||
                    t('crm.booking.resend_this_message') ||
                    'this message'
                )
                .replace('{name}', contact.first_name || '')}
            </p>
            {/* What a repeat actually does, said once rather than per kind:
                every one of them is rebuilt from the booking as it stands now,
                which is the thing a client who lost the mail needs. */}
            <p className="mt-2 text-xs text-[var(--v2-text-muted)]">
              {t('crm.booking.resend_note') ||
                'It is rebuilt from the booking as it stands now, so the details will be current.'}
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
                    `/api/scheduling/bookings/${pendingConfirmationBookingId}/resend`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      /* What to send again. The route rebuilds that kind from
                         the booking as it stands now, rather than replaying a
                         stored body that may describe a time since moved. */
                      body: JSON.stringify({ kind: pendingResendKind }),
                    }
                  );
                  const data = await response.json();
                  if (!response.ok || !data.success) {
                    throw new Error(data.error || 'Failed to send the confirmation');
                  }
                  /*
                   * ── IT NAMES WHAT WAS SENT ────────────────────────────
                   * "Confirmation sent" was accurate while this button only
                   * ever sent confirmations. It now sends the kind it was
                   * attached to, so on a cancellation notice it reported the
                   * wrong message — the same mismatch the button itself had.
                   *
                   * Same wording as the rail and the dialog, so all three
                   * agree about what just happened.
                   */
                  toast.success(
                    (t('crm.booking.resent_done') || 'Sent again: {what}').replace(
                      '{what}',
                      translated(t, `crm.journey.mail_kind.${pendingResendKind}`) ||
                        t('crm.booking.resend_this_message') ||
                        'this message'
                    )
                  );
                  /*
                   * BOTH, because they are two different reads.
                   *
                   * `fetchActivities` refreshes the contact timeline. The
                   * booking journey is built from `sessions` — that is where
                   * the attempts are paired with their mail — so refreshing
                   * only activities left the rail showing the state from
                   * before the send: the row was written, linked and flagged
                   * as a resend, and the card still said one message.
                   *
                   * Reported as "I resent the email and nothing got updated",
                   * which was exactly true of everything the owner could see.
                   */
                  fetchSessions(contact.id, { silent: true });
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

      {/* Refund confirmation resend */}
      <Dialog open={showRefundEmailConfirm} onOpenChange={setShowRefundEmailConfirm}>
        <DialogContent className="sm:max-w-md" dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>
              {t('crm.refund.resend_confirmation_title') || 'Resend refund confirmation'}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-[var(--v2-text-secondary)]">
              {(
                t('crm.refund.resend_confirmation_message') ||
                'Send {name} the refund confirmation again? It says how much came back and when, and carries no payment link.'
              ).replace('{name}', contact.first_name || '')}
            </p>
          </div>
          <div className={`flex gap-3 ${isRTL ? 'flex-row-reverse' : ''}`}>
            <Button
              variant="outline"
              onClick={() => {
                setShowRefundEmailConfirm(false);
                setPendingRefundInvoiceId(null);
              }}
              disabled={sendingRefundEmail}
            >
              {t('common.cancel') || 'Cancel'}
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={async () => {
                if (!pendingRefundInvoiceId) return;
                setSendingRefundEmail(true);
                try {
                  const response = await fetch(
                    `/api/payments/invoices/${pendingRefundInvoiceId}/resend-refund-confirmation`,
                    { method: 'POST', headers: { 'Content-Type': 'application/json' } }
                  );
                  const data = await response.json();
                  if (!response.ok || !data.success) {
                    throw new Error(data.error || 'Failed to send the refund confirmation');
                  }

                  /*
                   * "Nothing was sent" is not a failure, and must not be shown
                   * as one. The client simply has no address on file — a fact
                   * about their record, not a fault in the send — and a red
                   * toast there would send the owner looking for a broken
                   * system that is working.
                   */
                  if (data.data?.sent) {
                    toast.success(t('crm.refund.email_sent') || 'Refund confirmation sent');
                  } else {
                    toast.warning(
                      t('crm.refund.email_no_address') ||
                        'No email address on file for this client, so nothing was sent.'
                    );
                  }

                  /* The refund confirmation is linked to its booking, so it
                     belongs on that booking's rail — which is built from
                     `sessions`, not from the activity timeline. */
                  fetchSessions(contact.id, { silent: true });
                  fetchActivities(contact.id, { silent: true });
                  setShowRefundEmailConfirm(false);
                  setPendingRefundInvoiceId(null);
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : 'Failed to send the refund confirmation'
                  );
                } finally {
                  setSendingRefundEmail(false);
                }
              }}
              disabled={sendingRefundEmail}
            >
              {sendingRefundEmail
                ? t('common.sending') || 'Sending...'
                : t('crm.intake.send') || 'Send'}
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
              ).replace('{name}', contact.first_name || '')}
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
