// Shared types for CRM Contact Drawer components

import type { CRMContact } from '@/lib/repositories/CRMContactRepository';
import type { BookingStatus, MeetingStatus } from '@/lib/business-os/bookingStatus';
import type { IntakeQuestion } from '@/lib/business-os/intake/types';
import type { CRMActivity } from '@/lib/repositories/CRMActivityRepository';
import type { CRMPipelineStage } from '@/lib/repositories/CRMPipelineStagesRepository';
import type { EmailSendStatus } from '@/lib/business-os/emailSendStatus';

export interface PaymentTransaction {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  description?: string;
}

/**
 * A completed intake, as stored on the booking.
 *
 * `questions` is a snapshot taken when the client answered, which is what lets
 * this be rendered without fetching anything — and what keeps it readable after
 * the form has been edited and republished.
 *
 * `template_id` and `template_key` are the shape submissions had before the
 * shared catalogue was replaced. Kept optional so an older row still parses;
 * nothing reads them, and a submission carrying them has no `questions`, so it
 * renders under its own keys.
 */
export interface IntakeResponses {
  form_id?: string;
  version?: number;
  questions?: IntakeQuestion[];
  responses: Record<string, unknown>;
  template_id?: string;
  template_key?: string;
}

/**
 * One arranged appointment, as the journey draws it.
 *
 * Mirrors `SchedulingMeetingAttempt` from the repository rather than importing
 * it: this file is the drawer's own contract and is imported by client
 * components, and the repository module is server-side only (CLAUDE.md rule 1).
 */
/** One mail sent about a specific attempt, as the journey lists it. */
export interface AttemptEmail {
  id: string;
  subject: string;
  /** When it went out. `sent_at` where the provider confirmed it. */
  at: string | null;
  status: EmailSendStatus;
  /**
   * A REPEAT of mail the client already had — the owner pressing "send again".
   *
   * Recorded on the row (20261079), never derived: every reschedule notice
   * shares one subject, so "this subject appeared before" would label the
   * second genuine notice a resend of the first.
   */
  isResend?: boolean;
  /**
   * WHAT the message was (20261081) — a confirmation, a reschedule notice, a
   * reminder — as its sender declared it.
   *
   * The journey names the kind instead of echoing `subject`, which on one
   * booking repeats the service name on every row and tells the owner nothing:
   * it is the same booking throughout, so it is the same service throughout.
   *
   * Null for rows predating the column, which render by subject exactly as they
   * did before. A string rather than the sender's union, because the column is
   * TEXT with no CHECK and an unrecognised value must degrade, not crash.
   */
  kind?: string | null;
}

export interface MeetingAttempt {
  id: string;
  booking_id: string;
  /**
   * Who recorded the outcome: the owner, the client, or an automation.
   *
   * NULL on every row predating 20261078, which were deliberately not
   * backfilled — the owner's drawer is not the only writer, so assuming them
   * would have put a guess in a column the journey presents as a record.
   */
  outcome_by?: 'owner' | 'client' | 'system' | null;
  /**
   * WHEN the outcome was recorded (20261080).
   *
   * Lets the rail place the outcome among this attempt's emails in order, so
   * a mail sent while the appointment was still ahead sits ABOVE the line
   * saying it was missed, and one sent because it was missed sits below.
   * Without it the node showed a single final state over mail spanning the
   * whole of its life, and nothing said which belonged to which.
   */
  outcome_at?: string | null;
  /**
   * The mail sent about THIS attempt, oldest first.
   *
   * Matched on `email_sends.meeting_id`, which exists from 20261077 — so it is
   * the recorded link, not a guess. Empty for attempts whose mail predates the
   * column, and for attempts nothing was sent about.
   *
   * Attached by the drawer rather than the API: the emails are already fetched
   * for the confirmation step, so pairing them here costs no extra request.
   */
  emails?: AttemptEmail[];
  start_time: string;
  end_time: string;
  timezone: string | null;
  /** `held` | `no_show` | `cancelled`, or null while nobody has said. */
  meeting_status: MeetingStatus | null;
  /**
   * Who caused this attempt to exist (20261082), for one a move created.
   *
   * Null on attempt #1 — the booking put it there, not a move — and on every
   * row predating the column. The journey then says the time was changed
   * without naming a side, rather than repeating the assumption that produced
   * the bug: every move was labelled the owner's, including a client's own
   * reschedule from the public portal.
   */
  moved_by?: 'owner' | 'client' | 'system' | null;
  /**
   * Which SESSION of a package this is (20261086), or null on an ordinary
   * booking, which has one appointment.
   *
   * What separates two readings of the same list: on an ordinary booking the
   * attempts are tries at ONE hour, and here each numbered session is a
   * different hour. Read the wrong way, a package of six draws as six attempts
   * at one date.
   */
  session_number?: number | null;
  /** 1 for the first arrangement, incrementing for each later attempt. */
  occurrence_number: number;
  created_at: string | null;
}

export interface Appointment {
  /**
   * The owner's answer when the meeting was cancelled (20261083): is the quote
   * still coming?
   *
   * NULL means nobody was asked, which is NOT the same as yes. Only `false`
   * changes the journey, where it asks whether the booking should be closed.
   */
  proposal_continues?: boolean | null;
  id: string;
  service_id: string;
  client_first_name: string;
  client_last_name?: string;
  client_email?: string;      // Client email at time of booking
  client_phone?: string;      // Client phone at time of booking
  start_time: string | null;  // null for product purchases (no time slot)
  end_time: string | null;    // null for product purchases (no time slot)
  timezone?: string;
  status: BookingStatus;
  /**
   * How this booking came to exist: `quote_request`, `website`, `manual`,
   * `proposal`.
   *
   * The journey's opening step is the only place it is shown, and it is the one
   * fact on that row that appears nowhere else on the card — the service name
   * is the card's title and the client is the drawer's subject. Undeclared, it
   * read as `undefined` and the row showed the client's name alone.
   */
  booking_source?: string | null;
  /**
   * What happened at the APPOINTMENT, independent of the job above.
   *
   * `null` means nobody has said yet, which is the ordinary state of a past
   * meeting. Its own column since 20261072, so the two facts no longer have to
   * overwrite each other — a consultation can be held and its job cancelled.
   */
  meeting_status?: MeetingStatus;
  /**
   * Every appointment that was arranged for this booking, oldest first.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY A BOOKING CAN HAVE MORE THAN ONE
   *
   * `meeting_status` above describes the CURRENT attempt. A booking rescheduled
   * after somebody said what happened — a no-show that was moved, a
   * consultation held and then booked again — gets a new row rather than
   * having its time overwritten, so the missed appointment keeps both its
   * outcome and the day it was actually for.
   *
   * Absent or length ≤ 1 for every booking that has never been rescheduled
   * after an outcome, which is the overwhelming majority. The journey draws its
   * single meeting node for those, exactly as before; the rows only appear
   * where there is genuinely more than one attempt to show.
   *
   * Supplied only when the fetch asks for it (`include_attempts=true`), since
   * it costs a second query and nothing but the journey reads it.
   */
  attempts?: MeetingAttempt[];
  payment_status?: 'pending' | 'paid' | 'refunded';  // Payment status from booking
  payment_id?: string;        // Transaction ID for refunds
  notes?: string;
  /**
   * Why it was cancelled, and by whom.
   *
   * `cancel_reason` is the countable code from `cancellationReasons`;
   * `cancellation_reason` is the older free text and is the FALLBACK for rows
   * cancelled before the code existed — dropping it would erase what they say.
   */
  cancel_reason?: string | null;
  cancel_note?: string | null;
  /**
   * A PACKAGE's meeting: the purchase it belongs to, and which of the N it is.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Carried so the drawer can tell a session from a job. Without it each of the
   * six meetings of an accepted package drew its own client journey, quote step
   * and all — "the quote will be sent after the meeting", on a meeting the
   * quote had already created and been paid for.
   * ───────────────────────────────────────────────────────────────────────────
   */
  parent_booking_id?: string | null;
  /**
   * The MEETING this row stands for, when it is a package session.
   *
   * A package is one booking with N meetings, so a session has no booking of
   * its own and its outcome is recorded against the meeting — which is a
   * different endpoint from a booking's. Present only on the view-model rows
   * the drawer builds for a package's sessions; absent on every real booking.
   */
  meeting_id?: string | null;
  occurrence_number?: number | null;
  cancelled_by?: 'client' | 'owner' | 'system' | null;
  cancellation_reason?: string | null;
  intake_responses?: IntakeResponses;
  intake_completed_at?: string;
  /**
   * When the form went out, and when the client was nudged about it.
   *
   * On the row all along and never carried here, which is why the journey's
   * intake card had nothing to say: the step knew only whether a RESPONSE
   * existed, so a form that had been sent and a form that had never been sent
   * were the same empty card.
   */
  intake_sent_at?: string;
  intake_reminded_at?: string;
  created_at?: string;  // For product purchases, use created_at as the order date
  service?: {
    service_name: string;
    /**
     * Does booking this involve picking a time?
     *
     * Replaces `is_product`, which was declared here and in two component-local
     * types and exists in NO table — so every read of it was `undefined`, and
     * the journey fell back to "has no start time" as its only test. That proxy
     * reclassified a scheduled booking whose time was missing, hiding the fault
     * instead of showing it.
     *
     * `is_scheduled` is one of the three facts the service model is built on,
     * beside `collection` and `sale_mode`. The platform has no product status.
     */
    is_scheduled?: boolean | null;
    /** Sold outright, or quoted first. Decides whether a quote step appears. */
    sale_mode?: 'direct' | 'proposal' | null;
    /** The service's own currency — the only currency a quote can inherit. */
    currency?: string;
  };
}

export interface ContactTask {
  id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  due_date: string | null;
  created_by: string;
  created_at: string;
}

export interface ContactEmail {
  id: string;
  subject: string;
  to_email: string;
  /**
   * The booking and the APPOINTMENT this mail was about (20261077).
   *
   * Already on the wire — the emails route selects the whole row — so, as with
   * `delivered_at` below, only this type was hiding them.
   *
   * `meeting_id` is what lets the journey file a confirmation under the
   * appointment it confirmed and a reschedule request under the one that was
   * missed, instead of stacking every mail on the first attempt. Null on the
   * 704 rows that predate the columns, where the journey falls back to matching
   * by time and service name.
   */
  booking_id?: string | null;
  meeting_id?: string | null;
  /*
   * From the shared roster, not a local union. The inline version omitted
   * `'complained'` — a value the delivery webhook writes — which is why nothing
   * flagged the places that then failed to handle it.
   */
  status: EmailSendStatus;
  sent_at: string | null;
  /**
   * When the recipient's mail server accepted it.
   *
   * On the wire already — the emails route selects the whole row — and only this
   * type was hiding it. It is the one delivery fact the platform now learns,
   * since open and click tracking are deliberately off.
   */
  delivered_at: string | null;
  opened_at: string | null;
  created_at: string;
}

export interface ContactDocument {
  id: string;
  name: string;
  document_type: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  created_at: string;
  download_url?: string;
}

/**
 * How a service is sold, as the booking card has to say it.
 *
 * A single amount could not tell these apart, so every booking read as one
 * number and an installment sale showed the whole agreement as though it had
 * been collected — ₪1,000 next to a client who had paid ₪333.
 */
export interface SessionPaymentPlan {
  installmentCount: number;
  /** One period — what is taken now, not the agreement. */
  installmentAmount: number;
  totalAmount: number;
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
  /** From the plan's local mirror once it exists; undefined before then. */
  periodsPaid?: number;
  /**
   * Named stages, for a plan that is not a uniform instalment schedule.
   *
   * An instalment plan is "three payments of the same size, monthly", which the
   * fields above describe completely. A quoted job's plan is not: its stages
   * have names, different amounts, and most of them fall due when the owner
   * says the work happened rather than on a date. Optional, so every existing
   * plan is unaffected.
   */
  stages?: Array<{
    id: string;
    /**
     * The SESSION this stage bills, for a package billed per meeting.
     *
     * A package is one booking with N meetings, so N stages share one
     * `booking_id` and it can no longer say which session a stage belongs to.
     * Null on every ordinary stage, which bills a job rather than an hour.
     */
    meetingId?: string | null;
    label: string | null;
    amount: number;
    status: string;
    /** 'date' bills on a schedule; 'manual' waits for the owner to mark it done. */
    trigger: 'date' | 'manual' | null;
    invoiceId: string | null;
    /**
     * The transaction this stage's money arrived as, where there is no invoice.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * A quoted milestone raises an invoice and is refunded through it. An
     * INSTALMENT period charged by the processor does not: the money lands as a
     * `payment_transactions` row and `payment_plan_installments.invoice_id`
     * stays null, with only `transaction_id` set.
     *
     * The stage row gates Refund on having something to refund AGAINST, and
     * `invoiceId` was the only key it carried — so a paid instalment offered no
     * refund at all. The owner could see ₪400 collected and had no way to give
     * it back from the row that reported it.
     *
     * Nothing downstream needed building: `/api/payments/refunds` has always
     * accepted `transaction_id` as an alternative to `invoice_id`, and
     * `RefundModal` has always had the prop. Only this field was missing to
     * carry it from the row to the dialog.
     * ─────────────────────────────────────────────────────────────────────────
     */
    transactionId?: string | null;
    dueDate: string | null;
    /**
     * When the money actually arrived.
     *
     * The row could say a stage was paid and never when, which is the first
     * thing an owner reconciling a bank statement needs. Selected by the
     * proposals API all along and dropped at the mapping.
     */
    paidAt?: string | null;
    /**
     * How much of THIS stage came back, and when.
     *
     * A job can have two paid milestones and a refund against only one of them,
     * so the figure belongs to the stage. The card's totals sum these; the
     * stage's own row is the only place that can say which money was returned.
     */
    refundedAmount?: number | null;
    refundedAt?: string | null;
  }>;
}

export interface SessionPayment {
  id?: string;
  /** `amount` is what is due for THIS payment; for a plan that is one period. */
  amount: number;
  currency: string;
  status: 'paid' | 'pending' | 'failed' | 'free' | 'refunded';
  /** How the service is sold. Absent means an ordinary single payment. */
  plan?: SessionPaymentPlan;
  paidAt?: string;
  refundedAt?: string;  // When the refund was processed
  /**
   * How much of this payment has been returned.
   *
   * Distinct from `status: 'refunded'`, which only a FULL refund produces. A
   * partial refund leaves the status at `paid`, so the bookings tab showed
   * nothing at all — a client could be given half their money back and the
   * booking would look untouched.
   */
  refundedAmount?: number;
  /**
   * The money was recorded by hand, never taken by a processor.
   *
   * True only when every settled charge on the booking carries
   * `processor_type: 'manual'` — cash, a bank transfer, a cheque. It decides
   * one thing: whether refunding here can actually move money, or whether the
   * owner has to return it themselves and this only records that they did.
   *
   * It was previously guessed at from the ABSENCE of `scheduling_bookings
   * .payment_id`, a legacy single-payment column that is null on 74 of this
   * account's 81 paid bookings — so the warning appeared on card payments,
   * which is every instalment sale and every plan.
   */
  isManual?: boolean;
  /**
   * What was actually invoiced, when there is an invoice.
   *
   * `amount` is the SERVICE's current price — a live figure that can be edited,
   * zeroed or lost with the service. The receipt must not depend on it: money
   * that changed hands is a fact about the past.
   */
  invoicedAmount?: number;
  paymentMethod?: string;  // 'card', 'cash', 'bank_transfer', etc.
  last4?: string;  // Last 4 digits of card
  // Invoice data for resend functionality and due date display
  invoiceId?: string;
  /**
   * The invoice that is currently OWED, if any.
   *
   * Distinct from `invoiceId`, which names the invoice this payment object
   * DESCRIBES — the last one paid, once money has landed. Resending wants the
   * outstanding one; refunding wants the paid one. One field cannot be both,
   * and while it tried, the resend button pointed at a settled invoice.
   *
   * Only a plan sets this. A single payment has at most one invoice, so the
   * two questions have the same answer and `invoiceId` suffices.
   */
  outstandingInvoiceId?: string;
  invoiceStatus?: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  invoiceDueDate?: string;
  invoiceSentAt?: string;
}

// Email confirmation sent to client
export interface BookingConfirmationEmail {
  id: string;
  subject: string;
  /*
   * From the shared roster. This union omitted `'complained'`, which is exactly
   * why `buildJourneySteps` could paint a spam complaint as a completed step
   * without the compiler objecting.
   */
  status: EmailSendStatus;
  sentAt?: string;
  openedAt?: string;
  deliveredAt?: string;
}

// Client info snapshot at time of booking (to detect changes)
export interface BookingClientSnapshot {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  // If different from current contact info, we can show what changed
}

// Full booking journey data - everything about this client's booking
export interface BookingJourneyData {
  // Service/Product info
  service: {
    id: string;
    name: string;
    isProduct: boolean;
    price?: number;
    currency?: string;
    duration?: number;  // in minutes, for services
  };

  // Schedule (null for products)
  schedule?: {
    startTime: string;
    endTime: string;
    timezone?: string;
    location?: string;
  };

  // Client info at time of booking
  clientSnapshot?: BookingClientSnapshot;

  // Payment details
  payment?: SessionPayment;

  // Intake form
  intake?: {
    templateId: string;
    templateName?: string;
    completedAt?: string;
    responses: Record<string, unknown>;
  };

  // Confirmation email
  confirmationEmail?: BookingConfirmationEmail;

  // Booking metadata
  createdAt: string;
  status: BookingStatus;
  notes?: string;
}

// Booking journey step - each booking tracks its own client journey
export interface BookingJourneyStep {
  id: string;
  key: string;  // Step key for translations: 'booked', 'payment', 'intake', 'confirmation', 'session', etc.
  /**
   * `refunded` is its own state, not a flavour of `completed`.
   *
   * It was mapped to `completed` with the note "transaction done", and
   * `completed` is GREEN — so a job whose every shekel had gone back wore the
   * same node as a sale collected in full.
   */
  status: 'completed' | 'active' | 'pending' | 'failed' | 'skipped' | 'refunded';
  label?: string;  // Optional override label (if not using translation key)
  details?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;  // Additional data (e.g., payment amount, intake responses)
}

// Re-export for backward compatibility
export type BookingStepData = BookingJourneyStep;

export interface SessionCardData {
  booking: Appointment;
  payment: SessionPayment | null;
  // Full journey data - all the info about this booking
  journeyData?: BookingJourneyData;
  // Journey steps - the actual client journey for this booking (optional, can be derived from journeyData)
  journeySteps?: BookingJourneyStep[];
  /**
   * The meetings this PURCHASE bought, for a package.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A package is one client journey, not six. Left flat, an accepted
   * six-session package drew six cards — six "jobs" for one agreement, each
   * with its own quote step and its own history, and nothing on screen saying
   * they were the same block.
   *
   * So the children hang off their container and are rendered INSIDE its card:
   * one journey, with its meetings listed under it, each keeping its own date,
   * status and actions because each is a real appointment that can be held,
   * missed, moved or called off on its own.
   *
   * Empty for every ordinary booking, which is almost all of them.
   * ───────────────────────────────────────────────────────────────────────────
   */
  meetings?: SessionCardData[];
}

export interface ContactFormData {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  stage: string;
  source: string;
  tags: string[];
  notes: string;
  custom_fields: Record<string, unknown>;
}

// Props shared across sections
export interface SectionProps {
  contact: CRMContact;
  t: (key: string) => string;
  isRTL: boolean;
  language: string;
}

export type { CRMContact, CRMActivity, CRMPipelineStage };
