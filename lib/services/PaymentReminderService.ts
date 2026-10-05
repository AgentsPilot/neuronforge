/**
 * Payment Reminder Service
 *
 * Handles payment reminders for invoices and installments.
 * This service:
 * 1. Schedules reminders based on due dates
 * 2. Sends reminders via configured channels (email, SMS, in-app)
 * 3. Tracks reminder history
 * 4. Emits events for AI kernel consumption
 *
 * Reminders work with the automation engine and can be triggered
 * by events or scheduled directly.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { emitPaymentEvent, PaymentProcessorType } from '@/lib/services/PaymentEventService';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { PaymentReminderRepository } from '@/lib/repositories/PaymentReminderRepository';
import { safeTimezone, businessDateKey, businessClock, businessInstant, shiftBusinessDateKey } from '@/lib/scheduling/businessTime';
import { sendEmail } from '@/lib/notifications/emailTransport';
import { generateChaseInvoiceEmail } from '@/lib/email/templates/insight-actions';
import { resolveEmailBranding } from '@/lib/email/branding';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { getBusinessLocale } from '@/lib/services/BookingEmailService';
import { isServiceDateInvoice, waitsForItsSession } from '@/lib/payments/invoiceTerms';
import { isPlanStopped } from '@/lib/payments/planStatus';
// The two shared rules for "this money has moved". Both read the ledger fields
// rather than `status`, which is a projection and lags behind a refund.
import { isSettledInvoice, hasBeenRefunded } from '@/lib/payments/invoiceSettlement';
import { stripeConnectRepository } from '@/lib/repositories/PaymentRepository';

const logger = createLogger({ service: 'PaymentReminderService' });

// Durable-queue drain constants (Q1). Lease > the reminders cron's maxDuration (60s).
const LEASE_SECONDS = 90;
const MAX_ATTEMPTS = 5;

/**
 * The hours, in the BUSINESS's timezone, when a chasing email may be sent.
 *
 * 08:00 to 20:00. Chasing somebody for money at four in the morning is worse
 * than chasing them a few hours late, and until the cron moved to hourly this
 * was enforced by running the job once a day — see `sendableAt`.
 */
const REMINDER_WINDOW_OPENS_AT = 8;
const REMINDER_WINDOW_CLOSES_AT = 20;

// ==================== TYPES ====================

export type ReminderType = 'upcoming_due' | 'due_today' | 'overdue' | 'retry_failed' | 'payment_received';
export type ReminderChannel = 'email' | 'sms' | 'in_app';
// 'processing' = claimed/in-flight (durable-queue claim pattern). 'sent'/'failed'/'cancelled' terminal.
export type ReminderStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';

export interface PaymentReminder {
  id: string;
  user_id: string;
  invoice_id: string | null;
  installment_id: string | null;
  contact_id: string;
  reminder_type: ReminderType;
  scheduled_at: string;
  sent_at: string | null;
  channel: ReminderChannel;
  template_id: string | null;
  status: ReminderStatus;
  metadata: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
  // NOTE: `payment_reminders` has no `updated_at` column (M5) — do not add one.
}

export interface ReminderConfig {
  enabled: boolean;
  daysBefore: number[]; // Days before due date to send reminders
  overdueDays: number[]; // Days after due date to send overdue reminders
  channels: ReminderChannel[];
  defaultChannel: ReminderChannel;

  /**
   * May we write to this business's clients about money they owe?
   *
   * ─────────────────────────────────────────────────────────────────────────
   * `business_profiles.chase_invoices_enabled` — the answer the owner gave the
   * advisor's "Chase unpaid invoices" card, and now the only switch on the
   * overdue path.
   *
   * SEPARATE FROM `enabled`, DELIBERATELY. A reminder sent BEFORE the due date
   * is a courtesy: here is what is coming, on this day. A reminder sent AFTER
   * it says you are late. The first needs no permission and ships on; the
   * second is written in the owner's name to their client about a debt, and the
   * platform asks first.
   *
   * WHY THE SWITCH MOVED HERE
   *
   * There were two invoice chasers with two unrelated switches. This service
   * sent on days 1, 3 and 7 past due and asked nobody; the advisor's own sweep
   * sent once at 72 hours past due, gated on this column. They collided exactly
   * on day three — same invoice, same client, two emails, neither path aware of
   * the other, because they dedupe in different tables.
   *
   * The advisor's send was withdrawn and its switch given to this schedule, so
   * the card's promise and what actually happens are the same thing. See
   * `OperationalAutomation.carriedOutBy`.
   * ─────────────────────────────────────────────────────────────────────────
   */
  chaseOverdue: boolean;
}

export interface ScheduleReminderParams {
  invoiceId?: string;
  installmentId?: string;
  contactId: string;
  reminderType: ReminderType;
  scheduledAt: string;
  channel?: ReminderChannel;
  templateId?: string;
  metadata?: Record<string, unknown>;
}

export interface SendReminderParams {
  invoiceId?: string;
  installmentId?: string;
  contactId: string;
  channel: ReminderChannel;
  templateId?: string;
  includePaymentLink?: boolean;
  metadata?: Record<string, unknown>;
}

export interface PaymentReminderServiceResult<T> {
  data: T | null;
  error: Error | null;
}

// Default config
const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  enabled: true,
  daysBefore: [3, 1], // 3 days and 1 day before
  overdueDays: [1, 3, 7], // 1, 3, and 7 days after due
  channels: ['email'],
  defaultChannel: 'email',
  /*
   * Off when the profile cannot be read.
   *
   * Every other default here is generous because the cost of guessing wrong is
   * a reminder somebody did not need. The cost of guessing wrong on this one is
   * writing to a stranger's client about a debt without the owner having agreed
   * — so this default is the one that does nothing.
   */
  chaseOverdue: false
};

// ==================== SERVICE ====================

/**
 * Whole days a date-only due date is past, on the business's own calendar.
 *
 * Both sides are calendar dates ("2026-09-24"), so this is plain date
 * arithmetic with no zone left in it. The previous form subtracted a UTC
 * midnight from `Date.now()`, which mixed an instant with a date and drifted
 * by the business's offset — enough to move a reminder a whole day for
 * anywhere far from UTC, and to fire the wrong entry in `overdueDays`.
 *
 * Returns 0 or less when the due date has not passed where the business is.
 */
/*
 * The hours, WHERE THE BUSINESS IS, during which a client may be chased.
 *
 * This cron used to run once a day at 08:00 UTC and send to everyone at that
 * instant, so the hour a client was chased at was an accident of where the
 * business happened to be: 01:00 in Los Angeles, 21:00 in Auckland. It now
 * wakes hourly and each business is served during its own morning.
 */
const SEND_WINDOW_START = 8;
const SEND_WINDOW_END = 11;

export function overdueCalendarDays(dueDate: string, businessTodayKey: string): number {
  const asUtc = (key: string) => {
    const [y, m, d] = key.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((asUtc(businessTodayKey) - asUtc(dueDate)) / (24 * 60 * 60 * 1000));
}

/*
 * Moved out of the class body, where it had been placed: a plain `function`
 * declaration is not valid between two class members, so the whole module
 * failed to parse and every suite that imports it went red. Module scope is
 * where it belongs anyway — it touches no instance state.
 */
/**
 * Where the client can go to settle this.
 *
 * Stripe's hosted page is preferred because it can actually take the money.
 * Failing that, the invoice's own page — which shows the amount, the due date
 * and whatever manual payment instructions the business set. Null only when
 * neither exists, and the template then renders no button at all rather than a
 * dead one.
 */
function payLinkFor(entityDetails: Record<string, unknown>): string | null {
  const hosted = (entityDetails.payUrl as string | null) ?? null;
  if (hosted) return hosted;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const invoiceId = entityDetails.invoiceId as string | undefined;
  return appUrl && invoiceId ? `${appUrl}/invoice/${invoiceId}` : null;
}

export class PaymentReminderService {
  private supabase: SupabaseClient;
  private reminderRepo: PaymentReminderRepository;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
    this.reminderRepo = new PaymentReminderRepository(supabaseClient);
  }

  // ==================== SCHEDULING ====================

  /**
   * Schedule a payment reminder
   */
  async scheduleReminder(
    userId: string,
    params: ScheduleReminderParams
  ): Promise<PaymentReminderServiceResult<PaymentReminder>> {
    try {
      const config = await this.getUserReminderConfig(userId);

      /*
       * Which switch applies depends on which side of the due date this is.
       *
       * A past-due chase answers to `chase_invoices_enabled` ALONE, not to both
       * switches. If it needed `payment_reminder_enabled` as well, a business
       * that turned pre-due reminders off in settings would have the advisor
       * card still reading "Working on its own" while nothing was sent — the
       * card stating something it cannot know, which is the exact defect this
       * work exists to remove.
       *
       * So: before the date, `enabled`. After it, `chaseOverdue`. One switch
       * each, and each is the one the owner was actually shown.
       */
      const permitted = params.reminderType === 'overdue' ? config.chaseOverdue : config.enabled;

      if (!permitted) {
        return {
          data: null,
          error: new Error(
            params.reminderType === 'overdue'
              ? 'Chasing unpaid invoices has not been turned on'
              : 'Payment reminders are disabled'
          )
        };
      }

      logger.info({
        userId,
        contactId: params.contactId,
        reminderType: params.reminderType,
        scheduledAt: params.scheduledAt
      }, 'Scheduling payment reminder');

      const channel = params.channel || config.defaultChannel;

      const { data, error } = await this.reminderRepo.create({
        user_id: userId,
        invoice_id: params.invoiceId || null,
        installment_id: params.installmentId || null,
        contact_id: params.contactId,
        reminder_type: params.reminderType,
        // Held to sending hours rather than sent whenever the scan noticed. See
        // `sendableAt` — this is the rule the daily cron used to stand in for.
        scheduled_at: await this.sendableAt(new Date(params.scheduledAt), userId),
        channel,
        template_id: params.templateId || null,
        status: 'pending',
        metadata: params.metadata || {}
      });

      if (error) throw error;

      // Emit event
      await emitPaymentEvent(userId, {
        eventType: 'reminder.scheduled',
        entityType: 'reminder',
        entityId: data!.id,
        contactId: params.contactId,
        metadata: {
          reminderType: params.reminderType,
          scheduledAt: params.scheduledAt,
          channel,
          invoiceId: params.invoiceId,
          installmentId: params.installmentId
        }
      });

      logger.info({ reminderId: data!.id }, 'Reminder scheduled');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId, params }, 'Failed to schedule reminder');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Schedule reminders for an invoice based on due date
   */
  async scheduleInvoiceReminders(
    userId: string,
    invoiceId: string,
    contactId: string,
    dueDate: string
  ): Promise<PaymentReminderServiceResult<PaymentReminder[]>> {
    try {
      const config = await this.getUserReminderConfig(userId);
      if (!config.enabled) {
        return { data: [], error: null };
      }

      const reminders: PaymentReminder[] = [];

      // Schedule "days before" reminders
      for (const daysBefore of config.daysBefore) {
        /*
         * N days before the due date, at the start of the business's send
         * window — not midnight UTC, which is where `setDate` on a DATE-derived
         * value landed it and which is the previous afternoon or the same
         * lunchtime depending on the business.
         */
        const reminderDate = businessInstant(
          shiftBusinessDateKey(dueDate.slice(0, 10), -daysBefore),
          `${String(SEND_WINDOW_START).padStart(2, '0')}:00`,
          await this.businessZone(userId)
        );

        // Only schedule if in the future
        if (reminderDate > new Date()) {
          const result = await this.scheduleReminder(userId, {
            invoiceId,
            contactId,
            reminderType: 'upcoming_due',
            scheduledAt: reminderDate.toISOString(),
            channel: config.defaultChannel,
            metadata: { daysBefore }
          });

          if (result.data) {
            reminders.push(result.data);
          }
        }
      }

      /*
       * The "due today" reminder, at the start of the business's morning
       * rather than at midnight UTC — which for a business behind UTC is the
       * evening BEFORE the invoice is due.
       */
      const dueDayAt = businessInstant(
        dueDate.slice(0, 10),
        `${String(SEND_WINDOW_START).padStart(2, '0')}:00`,
        await this.businessZone(userId)
      );
      if (dueDayAt > new Date()) {
        const result = await this.scheduleReminder(userId, {
          invoiceId,
          contactId,
          reminderType: 'due_today',
          scheduledAt: dueDayAt.toISOString(),
          channel: config.defaultChannel
        });

        if (result.data) {
          reminders.push(result.data);
        }
      }

      logger.info({
        invoiceId,
        remindersScheduled: reminders.length
      }, 'Invoice reminders scheduled');

      return { data: reminders, error: null };
    } catch (error) {
      logger.error({ err: error, userId, invoiceId }, 'Failed to schedule invoice reminders');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Schedule reminders for an installment
   */
  async scheduleInstallmentReminders(
    userId: string,
    installmentId: string,
    contactId: string,
    dueDate: string
  ): Promise<PaymentReminderServiceResult<PaymentReminder[]>> {
    try {
      const config = await this.getUserReminderConfig(userId);
      if (!config.enabled) {
        return { data: [], error: null };
      }

      const reminders: PaymentReminder[] = [];

      // Schedule "days before" reminders
      for (const daysBefore of config.daysBefore) {
        /*
         * N days before the due date, at the start of the business's send
         * window — not midnight UTC, which is where `setDate` on a DATE-derived
         * value landed it and which is the previous afternoon or the same
         * lunchtime depending on the business.
         */
        const reminderDate = businessInstant(
          shiftBusinessDateKey(dueDate.slice(0, 10), -daysBefore),
          `${String(SEND_WINDOW_START).padStart(2, '0')}:00`,
          await this.businessZone(userId)
        );

        if (reminderDate > new Date()) {
          const result = await this.scheduleReminder(userId, {
            installmentId,
            contactId,
            reminderType: 'upcoming_due',
            scheduledAt: reminderDate.toISOString(),
            channel: config.defaultChannel,
            metadata: { daysBefore }
          });

          if (result.data) {
            reminders.push(result.data);
          }
        }
      }

      logger.info({
        installmentId,
        remindersScheduled: reminders.length
      }, 'Installment reminders scheduled');

      return { data: reminders, error: null };
    } catch (error) {
      logger.error({ err: error, userId, installmentId }, 'Failed to schedule installment reminders');
      return { data: null, error: error as Error };
    }
  }

  // ==================== SENDING ====================

  /**
   * Send a payment reminder immediately
   */
  async sendReminder(
    userId: string,
    params: SendReminderParams
  ): Promise<PaymentReminderServiceResult<{ sent: boolean; reminderId: string }>> {
    try {
      logger.info({
        userId,
        contactId: params.contactId,
        channel: params.channel
      }, 'Sending payment reminder');

      // Create the reminder record (ad-hoc callers get their own row).
      const { data: reminder, error: createError } = await this.reminderRepo.create({
        user_id: userId,
        invoice_id: params.invoiceId || null,
        installment_id: params.installmentId || null,
        contact_id: params.contactId,
        reminder_type: 'upcoming_due',
        scheduled_at: await this.sendableAt(new Date(), userId),
        channel: params.channel,
        template_id: params.templateId || null,
        status: 'pending',
        metadata: {
          ...params.metadata,
          includePaymentLink: params.includePaymentLink ?? true
        }
      });

      if (createError || !reminder) throw (createError ?? new Error('Failed to create reminder'));

      // Dispatch on the created row (shared with the cron drain).
      const { sent, errorMessage, skipped } = await this.dispatchReminderRow(reminder);

      // Update reminder status (B1: user-scoped in the repo; B2: no phantom updated_at).
      // M3: non-fatal — the reminder was already dispatched, so a failed status write
      // must log-and-continue, never abort the send flow.
      //
      // `cancelled`, not `failed`, when the thing it was chasing got settled:
      // nothing went wrong, and a queue full of "failed" rows that were simply
      // no longer needed hides the ones that actually broke.
      const { error: statusError } = await this.reminderRepo.updateStatus(reminder.id, userId, {
        status: sent ? 'sent' : skipped ? 'cancelled' : 'failed',
        sent_at: sent ? new Date().toISOString() : null,
        error_message: errorMessage
      });
      if (statusError) {
        logger.error(
          { err: statusError, reminderId: reminder.id },
          'Failed to persist reminder status (non-fatal — reminder already dispatched)'
        );
      }

      // Emit event. A skipped reminder is not a failure and is not reported as one.
      await emitPaymentEvent(userId, {
        eventType: sent ? 'reminder.sent' : skipped ? 'reminder.cancelled' : 'reminder.failed',
        entityType: 'reminder',
        entityId: reminder.id,
        contactId: params.contactId,
        metadata: {
          channel: params.channel,
          invoiceId: params.invoiceId,
          installmentId: params.installmentId,
          error: errorMessage
        }
      });

      return {
        data: { sent, reminderId: reminder.id },
        error: null
      };
    } catch (error) {
      logger.error({ err: error, userId, params }, 'Failed to send reminder');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Dispatch a single reminder ROW: resolve the contact, build entity details, and
   * send on the row's channel. Returns the outcome WITHOUT mutating the row — the
   * caller persists status. Shared by `sendReminder` (ad-hoc) and the cron drain
   * (`processDueReminders`), which operates on a claimed row.
   */
  private async dispatchReminderRow(
    reminder: PaymentReminder
  ): Promise<{ sent: boolean; errorMessage: string | null; skipped?: boolean }> {
    const userId = reminder.user_id;

    // Get contact info (user-scoped via the repository)
    const { data: contact } = await crmContactRepository.findById(reminder.contact_id, userId);
    if (!contact) {
      return { sent: false, errorMessage: 'Contact not found' };
    }

    // Get invoice/installment details
    let entityDetails: Record<string, unknown> = {};

    if (reminder.invoice_id) {
      const { data: invoice } = await this.supabase
        .from('payment_invoices')
        .select('*')
        .eq('id', reminder.invoice_id)
        .eq('user_id', userId)
        .single();

      if (invoice) {
        /*
         * Nothing is owed, so nothing is chased.
         *
         * A reminder is scheduled when the invoice is raised and dispatched days
         * later; whether it should still go out is a question about the invoice
         * NOW, not about the row that was written then. This was reading
         * `invoice.status` into the email and never looking at it, so a client
         * who had already paid was told their invoice was due today — the kind
         * of message that makes a business look like it is not keeping books.
         *
         * Checked here rather than only at scheduling time, because this is the
         * single point every reminder passes through. `cancelInvoiceReminders`
         * exists for the tidy path, but a reminder row can always outlive it —
         * a missed webhook, a payment taken by hand, a refund — and this guard
         * holds in all of those.
         */
        /*
         * THE MONEY, NOT THE STATUS.
         *
         * ─────────────────────────────────────────────────────────────────────
         * This listed the four settled STATUSES, and status is a projection —
         * `20260828d_invoice_refund_state.sql` says `refund_status` is the
         * field to read. An invoice refunded without first being marked paid
         * keeps `sent`, so it passed this guard and was chased.
         *
         * INV-00011 is the case, and it got through twice: `due_today` on
         * 30 Sep and `overdue` on 1 Oct, both after it was paid on the 29th and
         * refunded the same evening. ₪300 the client had already paid and been
         * given back, asked for twice, with a Stripe link reading PAID.
         *
         * The comment above already named a refund as the reason this guard has
         * to exist. It just asked the wrong field.
         *
         * `isSettledInvoice` carries the paid half — status OR `paid_at`,
         * because a webhook can stamp the date before the transition lands —
         * and `hasBeenRefunded` the refunded half, reading `refund_status` and
         * `refunded_amount` rather than the projection.
         * ─────────────────────────────────────────────────────────────────────
         */
        const settled =
          isSettledInvoice(invoice) ||
          hasBeenRefunded(invoice) ||
          ['cancelled', 'void'].includes(invoice.status);

        if (settled) {
          logger.info(
            {
              reminderId: reminder.id,
              invoiceId: invoice.id,
              status: invoice.status,
              paidAt: invoice.paid_at,
              refundStatus: invoice.refund_status,
            },
            'Skipping reminder: the invoice is no longer outstanding'
          );
          return { sent: false, errorMessage: null, skipped: true };
        }

        entityDetails = {
          type: 'invoice',
          invoiceNumber: invoice.invoice_number,
          amount: invoice.amount,
          currency: invoice.currency,
          dueDate: invoice.due_date,
          status: invoice.status,
          // Carried so the sender can offer a way to pay rather than only a
          // request for money.
          payUrl: invoice.stripe_hosted_invoice_url ?? null,
          invoiceId: invoice.id,
          clientName: invoice.client_name ?? null,
        };
      }
    } else if (reminder.installment_id) {
      const { data: installment } = await this.supabase
        .from('payment_plan_installments')
        .select('*')
        .eq('id', reminder.installment_id)
        .eq('user_id', userId)
        .single();

      if (installment) {
        // Same question, same answer: a period already collected is not chased.
        /*
         * `'billed'` belongs here, and its absence was a live hole.
         *
         * It is the status `PaymentStageBillingService` writes when a stage has
         * been invoiced. Without it a stage with a REAL invoice could still be
         * chased down this branch — which carries no invoice number and no pay
         * link — so the client got a blank-numbered dunning email about a bill
         * they had already received properly.
         */
        if (['paid', 'cancelled', 'refunded', 'billed'].includes(installment.status)) {
          logger.info(
            { reminderId: reminder.id, installmentId: installment.id, status: installment.status },
            'Skipping reminder: the installment is no longer outstanding'
          );
          return { sent: false, errorMessage: null, skipped: true };
        }

        entityDetails = {
          type: 'installment',
          installmentNumber: installment.installment_number,
          amount: installment.amount,
          currency: installment.currency,
          dueDate: installment.due_date,
          status: installment.status
        };
      }
    }

    const includePaymentLink = (reminder.metadata as Record<string, unknown>)?.includePaymentLink !== false;

    // Send based on channel
    let sent = false;
    let errorMessage: string | null = null;

    try {
      switch (reminder.channel) {
        case 'email':
          sent = await this.sendEmailReminder(
            userId,
            {
              email: contact.email ?? '',
              first_name: contact.first_name ?? '',
              last_name: contact.last_name ?? '',
            },
            entityDetails,
            includePaymentLink,
            reminder.contact_id ?? null
          );
          break;
        case 'sms':
          sent = await this.sendSmsReminder({ phone: contact.phone ?? '' }, entityDetails);
          break;
        case 'in_app':
          sent = await this.sendInAppReminder(userId, reminder.contact_id, entityDetails);
          break;
      }
    } catch (sendError) {
      errorMessage = sendError instanceof Error ? sendError.message : String(sendError);
      logger.error({ err: sendError, reminderId: reminder.id }, 'Failed to send reminder');
    }

    return { sent, errorMessage };
  }

  /**
   * Send email reminder (placeholder - integrate with email service)
   */

  /**
   * The reminder itself. Actually sends now.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHAT THIS REPLACES
   *
   * A stub. It logged "Would send payment reminder email" and returned
   * `true; // Simulated success`, so the queue row was marked SENT, the run
   * stats counted it, and a `reminder.sent` audit event was written — while no
   * client received anything. Every signal inside the product reported a
   * delivery that never happened, which is why nobody noticed for as long as
   * they did. `entitlements/config/catalog.ts` had this recorded as
   * `not_built` with exactly that reasoning.
   *
   * REUSES THE CHASE TEMPLATE. `generateChaseInvoiceEmail` already writes this
   * message for the insight-triggered path, and the two chases should not read
   * differently to a client depending on which internal route produced them.
   *
   * SENT AS THE BUSINESS. `ownerUserId` puts the business's name on the
   * envelope and its owner in Reply-To — a request for money from a company
   * the recipient has never heard of is ignored, or reported.
   *
   * TRANSACTIONAL, deliberately. It concerns a debt the recipient already owes
   * under an agreement they entered; it is not an attempt to sell them
   * anything, and it is not gated on marketing consent.
   * ───────────────────────────────────────────────────────────────────────────
   */
  private async sendEmailReminder(
    userId: string,
    contact: { email: string; first_name: string; last_name: string },
    entityDetails: Record<string, unknown>,
    includePaymentLink: boolean,
    /*
     * The client being chased, so the send is recorded against them.
     *
     * Without it a chase leaves no `email_sends` row, so the delivery webhook
     * has nothing to match — and a chase that bounced is indistinguishable from
     * a client ignoring it. That difference is the whole reason to chase again,
     * or to stop.
     */
    contactId: string | null
  ): Promise<boolean> {
    const to = contact.email?.trim();
    if (!to) {
      logger.warn({ userId }, 'Payment reminder has no email address');
      return false;
    }

    try {
      const [locale, profileResult] = await Promise.all([
        getBusinessLocale(userId),
        businessProfileRepository.findByUserId(userId),
      ]);
      const profile = profileResult.data as Record<string, unknown> | null;
      const branding = await resolveEmailBranding(userId, locale, profileResult.data);

      const businessName =
        (profile?.company_name as string) ||
        (profile?.invoice_company_name as string) ||
        'your provider';

      const dueRaw = entityDetails.dueDate as string | null | undefined;
      const dueDate = dueRaw ? new Date(dueRaw) : null;

      /*
       * Floored at zero. A reminder can run on the due date itself — day 0 of
       * `payment_overdue_reminder_days` — and "-1 days overdue" is not a
       * sentence.
       */
      const daysOverdue = dueDate
        ? Math.max(0, Math.floor((Date.now() - dueDate.getTime()) / 86_400_000))
        : 0;

      const clientName =
        (entityDetails.clientName as string)?.trim() ||
        [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim() ||
        'there';

      const { subject, html } = generateChaseInvoiceEmail({
        clientName,
        businessName,
        invoiceNumber: String(entityDetails.invoiceNumber ?? ''),
        amount: Number(entityDetails.amount ?? 0),
        currency: String(entityDetails.currency ?? 'USD'),
        dueDate,
        daysOverdue,
        /*
         * Stripe's hosted page where there is one, the invoice's own page
         * otherwise.
         *
         * Only two of eleven invoices on this database carry a Stripe URL —
         * an invoice raised outside Stripe has none — so keying the button on
         * it alone meant most chases said "you owe £500" and offered no way to
         * act on it. `/invoice/[id]` handles the paid, pending and
         * manual-instructions cases, so it is worth linking to whether or not
         * card payment is available. Same fallback `BookingEmailService`
         * already uses for the original invoice email.
         *
         * Withheld entirely when the owner asked for no link on this reminder.
         */
        payUrl: includePaymentLink ? payLinkFor(entityDetails) : null,
        branding,
        locale,
      });

      const result = await sendEmail({
        kind: 'transactional',
        to: [to],
        subject,
        html,
        ownerUserId: userId,
      });

      // Recorded either way, and before the early return: a chase that failed
      // is exactly what someone will look for later.
      await recordEmailSend({
        userId,
        contactId,
        toEmail: to,
        subject,
        bodyHtml: html,
        result,
      });

      if (!result.sent) {
        // Reported, not swallowed: the caller records this against the row so
        // the reason survives somewhere a person can read it.
        logger.error(
          { userId, to, error: result.error ?? result.blocked },
          'Payment reminder not sent'
        );
        return false;
      }

      logger.info(
        { userId, invoiceNumber: entityDetails.invoiceNumber, daysOverdue, provider: result.provider },
        'Payment reminder sent'
      );
      return true;
    } catch (err) {
      logger.error({ err, userId }, 'Payment reminder threw');
      return false;
    }
  }

  /**
   * Send SMS reminder (placeholder)
   */
  private async sendSmsReminder(
    contact: { phone: string },
    entityDetails: Record<string, unknown>
  ): Promise<boolean> {
    /*
     * NOT BUILT, and says so.
     *
     * It returned `true` — so a reminder on the SMS channel was marked SENT,
     * counted in the run stats and audited as `reminder.sent`, while nothing
     * left the building. That is the same invisible failure the email sender
     * had, and the reason it went unnoticed for as long as it did.
     *
     * Returning false records it as a failure, which is what it is. The row
     * carries the reason, the owner can see the channel does not work, and
     * `sms.messages` stays `not_built` in the entitlements catalog until a
     * provider is wired.
     */
    logger.warn({
      to: contact.phone,
      amount: entityDetails.amount,
      dueDate: entityDetails.dueDate,
    }, 'SMS reminders are not implemented — no provider is configured');

    return false;
  }

  /**
   * Send in-app notification
   */
  private async sendInAppReminder(
    userId: string,
    contactId: string,
    entityDetails: Record<string, unknown>
  ): Promise<boolean> {
    // TODO: Integrate with in-app notification system
    logger.info({
      userId,
      contactId,
      amount: entityDetails.amount,
      dueDate: entityDetails.dueDate
    }, 'In-app reminders are not implemented — nothing was delivered');

    // False for the same reason as the SMS channel above: a channel that
    // delivers nothing must not report a send.
    return false;
  }

  // ==================== CANCELLATION ====================

  /**
   * Cancel a specific reminder
   */
  async cancelReminder(
    reminderId: string,
    userId: string
  ): Promise<PaymentReminderServiceResult<void>> {
    try {
      const { error } = await this.reminderRepo.cancel(reminderId, userId);

      if (error) throw error;

      await emitPaymentEvent(userId, {
        eventType: 'reminder.cancelled',
        entityType: 'reminder',
        entityId: reminderId,
        metadata: {}
      });

      logger.info({ reminderId }, 'Reminder cancelled');
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, reminderId, userId }, 'Failed to cancel reminder');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Cancel all reminders for an invoice
   */
  async cancelInvoiceReminders(
    invoiceId: string,
    userId: string
  ): Promise<PaymentReminderServiceResult<number>> {
    try {
      const { data, error } = await this.reminderRepo.cancelByInvoice(invoiceId, userId);

      if (error) throw error;

      const cancelledCount = data || 0;
      logger.info({ invoiceId, cancelledCount }, 'Invoice reminders cancelled');
      return { data: cancelledCount, error: null };
    } catch (error) {
      logger.error({ err: error, invoiceId, userId }, 'Failed to cancel invoice reminders');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Cancel all reminders for an installment
   */
  async cancelInstallmentReminders(
    installmentId: string,
    userId: string
  ): Promise<PaymentReminderServiceResult<number>> {
    try {
      const { data, error } = await this.reminderRepo.cancelByInstallment(installmentId, userId);

      if (error) throw error;

      const cancelledCount = data || 0;
      logger.info({ installmentId, cancelledCount }, 'Installment reminders cancelled');
      return { data: cancelledCount, error: null };
    } catch (error) {
      logger.error({ err: error, installmentId, userId }, 'Failed to cancel installment reminders');
      return { data: null, error: error as Error };
    }
  }

  // ==================== BATCH PROCESSING (CRON) ====================

  /**
   * Process all due reminders (called by cron)
   */
  async processDueReminders(): Promise<{
    processed: number;
    sent: number;
    failed: number;
  }> {
    const stats = { processed: 0, sent: 0, failed: 0 };
    const runnerId = crypto.randomUUID();

    logger.info('Processing due reminders');

    try {
      // 1. Reaper first (safety-net sweep) — reclaim rows stuck in `processing`.
      const { data: reaped } = await this.reminderRepo.reapStale(LEASE_SECONDS, MAX_ATTEMPTS);
      if (reaped && reaped.length > 0) {
        logger.info({ reclaimed: reaped.length }, 'Reaped stale reminders');
      }

      // 2. Atomically claim a batch of due pending reminders (flips pending→processing).
      const { data: claimed, error: claimError } = await this.reminderRepo.claimDue(runnerId, 100);
      if (claimError) throw claimError;

      if (!claimed || claimed.length === 0) {
        logger.info('No due reminders to process');
        return stats;
      }

      logger.info({ count: claimed.length, runnerId }, 'Claimed due reminders');

      // 3. Dispatch each claimed row (the claimed row is the unit of work + idempotency).
      for (const reminder of claimed) {
        stats.processed++;
        try {
          const { sent, errorMessage, skipped } = await this.dispatchReminderRow(reminder);

          // Persist terminal status on the claimed row (B1 user-scoped; B2 no updated_at).
          // Settled-and-skipped is `cancelled`, so the failure count stays a
          // count of things that actually failed.
          const { error: statusError } = await this.reminderRepo.updateStatus(
            reminder.id,
            reminder.user_id,
            {
              status: sent ? 'sent' : skipped ? 'cancelled' : 'failed',
              sent_at: sent ? new Date().toISOString() : null,
              error_message: errorMessage
            }
          );
          if (statusError) {
            logger.error({ err: statusError, reminderId: reminder.id }, 'Failed to persist reminder status');
          }

          if (sent) stats.sent++;
          else if (!skipped) stats.failed++;

          // Emit outcome event.
          await emitPaymentEvent(reminder.user_id, {
            eventType: sent ? 'reminder.sent' : skipped ? 'reminder.cancelled' : 'reminder.failed',
            entityType: 'reminder',
            entityId: reminder.id,
            contactId: reminder.contact_id,
            metadata: {
              channel: reminder.channel,
              invoiceId: reminder.invoice_id,
              installmentId: reminder.installment_id,
              error: errorMessage
            }
          });
        } catch (error) {
          logger.error({ err: error, reminderId: reminder.id }, 'Error processing reminder');
          stats.failed++;

          // Mark the claimed row failed (leave the reaper to retry/dead-letter otherwise).
          await this.reminderRepo.updateStatus(reminder.id, reminder.user_id, {
            status: 'failed',
            error_message: error instanceof Error ? error.message : String(error)
          });
        }
      }

      logger.info(stats, 'Completed processing due reminders');
      return stats;
    } catch (error) {
      logger.error({ err: error }, 'Failed to process due reminders');
      throw error;
    }
  }

  /**
   * Check for overdue items and schedule overdue reminders
   */
  async processOverdueItems(): Promise<{
    overdueInvoices: number;
    overdueInstallments: number;
    remindersScheduled: number;
  }> {
    const stats = { overdueInvoices: 0, overdueInstallments: 0, remindersScheduled: 0 };
    /*
     * The scan bound is deliberately one day WIDE, and the real "is it late"
     * decision is made per business below.
     *
     * This cron fires at 08:00 UTC for everyone. Comparing `due_date` against
     * the UTC day told a business in Honolulu its invoice was overdue while it
     * was still 22:00 on the due date there — the client was chased for a debt
     * that was not yet late — and told one in Auckland nothing until most of
     * the following day had gone. A date-only column has to be compared on the
     * calendar the business keeps, so the query now over-selects by a day and
     * `overdueCalendarDays` decides.
     */
    const scanBound = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    logger.info('Checking for overdue items');

    try {
      /*
       * Both statuses, and that is a fix rather than a widening.
       *
       * This asked for `status = 'sent'` alone, while `markOverdueInvoices`
       * rewrites a late invoice from 'sent' to 'overdue'. Whoever ran first
       * won: a business that opened its dashboard before this cron had its
       * invoices restamped 'overdue', they fell out of this scan, and the
       * client was never reminded — silently, and only for the businesses
       * paying enough attention to check their dashboard.
       *
       * Reading both statuses makes the scan independent of who marked what.
       * It cannot double-send: the `findRecentByInvoice` check below skips any
       * invoice already reminded in the last 24 hours.
       */
      /*
       * STATUS IS NOT ENOUGH TO SAY THE MONEY IS STILL OWED.
       *
       * ───────────────────────────────────────────────────────────────────────
       * `20260828d_invoice_refund_state.sql` says it outright: `refund_status`
       * is the field to read, and `status` is a projection. An invoice refunded
       * without having first been marked paid keeps `sent` or `overdue` forever
       * — and this scan chased it.
       *
       * Live on this account, both client-facing:
       *
       *   INV-00011  overdue  paid 29 Sep  refunded ₪300 in full
       *   INV-00012  sent     paid 29 Sep  refunded ₪150 in full
       *
       * Both were emailed to the client asking for money they had already paid,
       * and whose Stripe page shows PAID — so the client clicks the link in the
       * chase and is told nothing is due. The same two also reached the owner's
       * daily briefing as receivables.
       *
       * `paid_at` is the other half: `isSettledInvoice` treats either it or the
       * status as settled, "because they can disagree — a processor webhook may
       * stamp `paid_at` before the status transition lands".
       *
       * Filtered in the QUERY rather than after it, so a page of 100 cannot
       * fill with settled invoices and starve the ones genuinely owed.
       * ───────────────────────────────────────────────────────────────────────
       */
      const { data: overdueInvoices } = await this.supabase
        .from('payment_invoices')
        .select('id, user_id, contact_id, due_date, booking_id, payment_terms')
        .in('status', ['sent', 'overdue'])
        .is('paid_at', null)
        .is('refunded_at', null)
        .or('refund_status.is.null,refund_status.eq.none')
        .lt('due_date', scanBound)
        .limit(100);

      if (overdueInvoices && overdueInvoices.length > 0) {
        stats.overdueInvoices = overdueInvoices.length;

        /*
         * Which of these are waiting on an appointment that has not happened?
         *
         * Read once for the batch rather than per invoice — this loop already
         * makes several round trips per row and does not need another.
         */
        const futureSession = await this.bookingsStillAhead(
          overdueInvoices
            .filter(inv => isServiceDateInvoice(inv))
            .map(inv => inv.booking_id as string)
        );

        for (const invoice of overdueInvoices) {
          /*
           * DO NOT CHASE FOR A SESSION THAT HAS NOT HAPPENED YET.
           *
           * ───────────────────────────────────────────────────────────────────
           * A booking's invoice is due on the day of the appointment — that is
           * its rule, and those words are printed on it. Moving the appointment
           * does not move the invoice, so a session pushed from October to
           * November left a bill dated October: overdue the next day, and the
           * client chased on days 1, 3 and 7, in the owner's name, for a
           * session a month away.
           *
           * The date is deliberately NOT moved to fix this. Rescheduling is
           * something the CLIENT can do from their own link, with no limit, so
           * a due date that followed the appointment would let anyone defer
           * their own bill indefinitely by moving it again.
           *
           * Narrow on purpose: only invoices carrying the service-date rule.
           * `due_on_receipt`, and the N-day terms a quote carries, are
           * deadlines the client actually agreed to and are chased on their own
           * date whatever the appointment is doing.
           * ───────────────────────────────────────────────────────────────────
           */
          if (waitsForItsSession(invoice, futureSession)) continue;

          // Whole days late on the BUSINESS's calendar; 0 or less means the
          // due date has not passed where the business is, so it is not late.
          const overdueDays = overdueCalendarDays(
            invoice.due_date,
            await this.businessToday(invoice.user_id)
          );
          if (overdueDays <= 0) continue;
          // Not the middle of this business's night.
          if (!(await this.isSendHour(invoice.user_id))) continue;

          // Get user's overdue reminder days
          const config = await this.getUserReminderConfig(invoice.user_id);

          /*
           * Has this business agreed to us chasing on its behalf?
           *
           * Asked before the day-of-the-month arithmetic, because the question
           * is not "is today a reminder day" but "may we write to this client
           * about a debt at all". A business that has not said yes is skipped
           * whatever the calendar says. See `ReminderConfig.chaseOverdue`.
           */
          if (!config.chaseOverdue) continue;

          // Check if we should send an overdue reminder
          if (config.overdueDays.includes(overdueDays)) {
            // Check if we haven't already sent one for this day (cross-user cron dedup)
            const { data: existingReminder } = await this.reminderRepo.findRecentByInvoice(
              invoice.id,
              'overdue',
              new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
            );

            if (!existingReminder || existingReminder.length === 0) {
              if (invoice.contact_id) {
                const result = await this.scheduleReminder(invoice.user_id, {
                  invoiceId: invoice.id,
                  contactId: invoice.contact_id,
                  reminderType: 'overdue',
                  scheduledAt: new Date().toISOString(),
                  metadata: { overdueDays }
                });

                if (result.data) {
                  stats.remindersScheduled++;
                }

                // Emit overdue event
                await emitPaymentEvent(invoice.user_id, {
                  eventType: 'invoice.overdue',
                  entityType: 'invoice',
                  entityId: invoice.id,
                  contactId: invoice.contact_id,
                  metadata: { overdueDays }
                });
              }
            }
          }
        }
      }

      // Get overdue installments
      const { data: overdueInstallments } = await this.supabase
        .from('payment_plan_installments')
        .select('id, user_id, contact_id, due_date')
        .eq('status', 'pending')
        .lt('due_date', scanBound)
        .limit(100);

      if (overdueInstallments && overdueInstallments.length > 0) {
        stats.overdueInstallments = overdueInstallments.length;

        for (const installment of overdueInstallments) {
          // Same calendar-day rule as the invoices above.
          const overdueDays = overdueCalendarDays(
            installment.due_date,
            await this.businessToday(installment.user_id)
          );
          if (overdueDays <= 0) continue;
          // Not the middle of this business's night.
          if (!(await this.isSendHour(installment.user_id))) continue;

          const config = await this.getUserReminderConfig(installment.user_id);

          // Same consent, same reason: a late instalment is money owed, and the
          // client hears about it in the owner's name.
          if (!config.chaseOverdue) continue;

          if (config.overdueDays.includes(overdueDays)) {
            const { data: existingReminder } = await this.reminderRepo.findRecentByInstallment(
              installment.id,
              'overdue',
              new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
            );

            if (!existingReminder || existingReminder.length === 0) {
              if (installment.contact_id) {
                const result = await this.scheduleReminder(installment.user_id, {
                  installmentId: installment.id,
                  contactId: installment.contact_id,
                  reminderType: 'overdue',
                  scheduledAt: new Date().toISOString(),
                  metadata: { overdueDays }
                });

                if (result.data) {
                  stats.remindersScheduled++;
                }

                // Emit overdue event
                await emitPaymentEvent(installment.user_id, {
                  eventType: 'installment.overdue',
                  entityType: 'installment',
                  entityId: installment.id,
                  contactId: installment.contact_id,
                  metadata: { overdueDays }
                });
              }
            }
          }

          // Update status to overdue
          await this.supabase
            .from('payment_plan_installments')
            .update({ status: 'overdue', updated_at: new Date().toISOString() })
            .eq('id', installment.id)
            .eq('status', 'pending');
        }
      }

      logger.info(stats, 'Completed processing overdue items');
      return stats;
    } catch (error) {
      logger.error({ err: error }, 'Failed to process overdue items');
      throw error;
    }
  }

  // ==================== CONFIGURATION ====================

  /**
   * Get user's reminder configuration
   */
  /**
   * The soonest moment a chasing email may go out.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY THIS EXISTS, AND WHY IT IS HERE RATHER THAN IN THE CRON SCHEDULE
   *
   * `/api/cron/payment-reminders` ran daily at 08:00, and that was not a
   * scheduling decision — it was a quiet-hours rule implemented in `vercel.json`.
   * It worked, at the price of every reminder waiting up to a day: the route
   * finds what is due and stamps `scheduled_at: now`, so a debt that came due at
   * 09:00 was not noticed until the next morning.
   *
   * Moving the cron to hourly fixes the delay and, on its own, would chase
   * somebody for money at 03:40. The rule belongs in the data, next to the thing
   * it constrains, so the drain can run as often as it likes.
   *
   * WHY NOT HOLD A CLAIMED ROW INSTEAD
   *
   * Because `claim_due_payment_reminders` does `attempts = attempts + 1`, and
   * `MAX_ATTEMPTS` is 5. A row released back to `pending` each hour from 20:00
   * would burn 12 attempts by morning and the reaper would dead-letter a
   * perfectly good reminder. So the window is applied when `scheduled_at` is
   * written: a reminder is never DUE outside it, no claim is wasted, and no
   * attempt is spent waiting.
   *
   * THE ZONE IS THE BUSINESS'S, not the client's, because the client's is not
   * something this platform knows. It is the right proxy — a business's clients
   * are usually near it — and `user_preferences.timezone` is the documented
   * authority for the clock. A business that never set one resolves to UTC via
   * `safeTimezone`, which is a guess, but a bounded one: the window still holds,
   * it is just anchored to the wrong meridian.
   * ───────────────────────────────────────────────────────────────────────────
   */
  private async sendableAt(desired: Date, userId: string): Promise<string> {
    const zone = await this.businessZone(userId);
    const { hour } = businessClock(desired, zone);

    if (hour >= REMINDER_WINDOW_OPENS_AT && hour < REMINDER_WINDOW_CLOSES_AT) {
      return desired.toISOString();
    }

    // Before the window opens, today still works; at or after it closes, the
    // next chance is tomorrow morning.
    const dateKey = businessDateKey(desired, zone);
    const target = hour < REMINDER_WINDOW_OPENS_AT ? dateKey : shiftBusinessDateKey(dateKey, 1);
    const open = businessInstant(target, `${String(REMINDER_WINDOW_OPENS_AT).padStart(2, '0')}:00`, zone);

    logger.info(
      { userId, zone, desired: desired.toISOString(), held: open.toISOString() },
      'Reminder falls outside sending hours; scheduled for the next opening'
    );

    return open.toISOString();
  }

  /**
   * The date it is where a business is, cached for the life of one cron run.
   *
   * A single run walks up to 200 rows that mostly belong to a handful of
   * businesses; without the cache each row would re-read `user_preferences`.
   */
  private businessZoneCache = new Map<string, string>();

  private async businessZone(userId: string): Promise<string> {
    const cached = this.businessZoneCache.get(userId);
    if (cached) return cached;
    let zone = 'UTC';
    try {
      const { data } = await this.supabase
        .from('user_preferences')
        .select('timezone')
        .eq('user_id', userId)
        .maybeSingle();
      zone = safeTimezone(data?.timezone);
    } catch (err) {
      logger.warn({ err, userId }, 'Could not resolve business timezone for reminders; using UTC');
    }
    this.businessZoneCache.set(userId, zone);
    return zone;
  }

  /**
   * Of these bookings, which have not happened yet?
   *
   * A booking with no start time is a product rather than an appointment —
   * there is no session to wait for, so it is never "still ahead" and its
   * invoice is chased normally.
   *
   * An unreadable answer returns an EMPTY set, which means chasing proceeds.
   * That is the safer failure: the alternative silently stops chasing every
   * overdue invoice in the batch, and an owner would see their receivables go
   * quiet with nothing to explain it.
   */
  private async bookingsStillAhead(bookingIds: string[]): Promise<Set<string>> {
    if (bookingIds.length === 0) return new Set();

    try {
      const { data, error } = await this.supabase
        .from('scheduling_bookings')
        .select('id, start_time')
        .in('id', bookingIds)
        .gt('start_time', new Date().toISOString());

      if (error) throw error;

      return new Set((data || []).map((row: { id: string }) => row.id));
    } catch (error) {
      logger.warn(
        { err: error },
        'Could not tell which sessions are still ahead; chasing as usual'
      );
      return new Set();
    }
  }

  /**
   * Is the plan behind this period provably unable to charge?
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Two ways it can be: the plan itself has stopped, or the business no longer
   * has a payment account for it to charge through. Either way the card will
   * never be debited again, so the money the client still owes has to be asked
   * for another way.
   *
   * Everything here FAILS CLOSED. A period with no plan recorded, a plan that
   * cannot be read, an unreadable account — all answer "it can still charge",
   * so the period is left alone. The cost of that is an instalment nobody
   * invoices, which is visible in receivables. The cost of guessing the other
   * way is a client billed twice for the same period, which is not.
   * ───────────────────────────────────────────────────────────────────────────
   */
  private async planCanNoLongerCharge(stage: {
    user_id: string;
    subscription_id?: string | null;
  }): Promise<boolean> {
    if (!stage.subscription_id) return false;

    try {
      const { data: plan, error } = await this.supabase
        .from('payment_plan_subscriptions')
        .select('status')
        .eq('id', stage.subscription_id)
        .eq('user_id', stage.user_id)
        .maybeSingle();

      if (error) throw error;
      if (!plan) return false;

      // Stopped for good: nothing will be charged against it again.
      if (isPlanStopped(plan.status as string)) return true;

      /*
       * Still marked live, but with nowhere to charge. This is the business that
       * removed its payment account: Stripe cancels the subscription at its end
       * and this row is never told, so the status alone would say "active" for
       * ever.
       */
      const { data: account, error: accountError } = await stripeConnectRepository.findByUserId(
        stage.user_id
      );

      if (accountError) throw accountError;

      return !account?.stripe_account_id;
    } catch (err) {
      logger.warn(
        { err, subscriptionId: stage.subscription_id },
        'Could not tell whether the plan can still charge; leaving the period alone'
      );
      return false;
    }
  }

  /** The date it is where the business is. */
  private async businessToday(userId: string): Promise<string> {
    return businessDateKey(new Date(), await this.businessZone(userId));
  }

  /**
   * Whether it is a decent hour to write to this business's clients.
   *
   * A window rather than an exact hour, for the reason the daily briefing uses
   * one: Vercel crons drift and can be skipped, and an exact test would cost a
   * business a whole day of chasing. Re-entry is free because
   * `findRecentByInvoice` already refuses a second reminder inside 24 hours.
   */
  private async isSendHour(userId: string): Promise<boolean> {
    const { hour } = businessClock(new Date(), await this.businessZone(userId));
    return hour >= SEND_WINDOW_START && hour < SEND_WINDOW_END;
  }

  async getUserReminderConfig(userId: string): Promise<ReminderConfig> {
    try {
      const { data: profile } = await this.supabase
        .from('business_profiles')
        .select('payment_reminder_enabled, payment_reminder_days_before, payment_overdue_reminder_days, payment_reminder_channels, chase_invoices_enabled')
        .eq('user_id', userId)
        .single();

      if (profile) {
        return {
          enabled: profile.payment_reminder_enabled ?? DEFAULT_REMINDER_CONFIG.enabled,
          daysBefore: profile.payment_reminder_days_before || DEFAULT_REMINDER_CONFIG.daysBefore,
          overdueDays: profile.payment_overdue_reminder_days || DEFAULT_REMINDER_CONFIG.overdueDays,
          channels: profile.payment_reminder_channels || DEFAULT_REMINDER_CONFIG.channels,
          defaultChannel: (profile.payment_reminder_channels?.[0] as ReminderChannel) || DEFAULT_REMINDER_CONFIG.defaultChannel,
          // `?? false` rather than `?? default`: an absent column is not consent.
          chaseOverdue: profile.chase_invoices_enabled ?? false
        };
      }

      return DEFAULT_REMINDER_CONFIG;
    } catch (error) {
      logger.warn({ err: error, userId }, 'Failed to get user reminder config, using defaults');
      return DEFAULT_REMINDER_CONFIG;
    }
  }

  /**
   * Update user's reminder configuration
   */
  async updateUserReminderConfig(
    userId: string,
    config: Partial<ReminderConfig>
  ): Promise<PaymentReminderServiceResult<ReminderConfig>> {
    try {
      const updates: Record<string, unknown> = {};

      if (config.enabled !== undefined) {
        updates.payment_reminder_enabled = config.enabled;
      }
      if (config.daysBefore !== undefined) {
        updates.payment_reminder_days_before = config.daysBefore;
      }
      if (config.overdueDays !== undefined) {
        updates.payment_overdue_reminder_days = config.overdueDays;
      }
      if (config.channels !== undefined) {
        updates.payment_reminder_channels = config.channels;
      }

      await this.supabase
        .from('business_profiles')
        .update(updates)
        .eq('user_id', userId);

      const newConfig = await this.getUserReminderConfig(userId);
      return { data: newConfig, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to update reminder config');
      return { data: null, error: error as Error };
    }
  }

  // ==================== QUERIES ====================

  /**
   * Get reminders for an entity
   */
  async getReminders(
    userId: string,
    options: {
      invoiceId?: string;
      installmentId?: string;
      contactId?: string;
      status?: ReminderStatus;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<PaymentReminderServiceResult<PaymentReminder[]>> {
    try {
      const { data, error } = await this.reminderRepo.list(userId, options);

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId, options }, 'Failed to get reminders');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Raise the invoice for every dated plan stage that has come due.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THE HALF OF A QUOTED PLAN THAT NOTHING BILLED.
   *
   * A quote billed in instalments names a count and a period, so acceptance
   * fixes every date. `ProposalAcceptanceService` raised the invoice for stage 1
   * and left a comment saying "the rest are raised as they fall due" — nothing
   * did. What happened instead is the worst available outcome: `processOverdueItems`
   * below found the stage late, flipped it to `overdue` and chased the client for
   * it, and because a stage carries no invoice number and no pay link, the email
   * asked for money with a blank invoice number and no button to pay it.
   *
   * Billing the stage is what makes that unreachable rather than what suppresses
   * it: once the invoice exists the stage is `billed` with an `invoice_id`, so the
   * `status = 'pending'` scan no longer matches it, and the chasing happens
   * through the invoice — which knows its own number and where to pay.
   *
   * RUN BEFORE `processOverdueItems`, for the same reason the scan runs before the
   * sender: a stage billed on this pass should be reminded on this pass.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY IT IS SAFE TO RE-ENTER.
   *
   * `billStage` claims each row with a conditional UPDATE the database permits
   * exactly once, so an overlapping cron, a retried invocation and a manual click
   * all reach the same row and only the first raises an invoice. Billing twice is
   * the one failure here that reaches a client, so the guard is not incidental.
   *
   * `trigger: 'date'` is passed through to that claim: a milestone waiting on the
   * owner must never be billed by a clock.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async billDueDatedStages(): Promise<{ billed: number; skipped: number; failed: number }> {
    const stats = { billed: 0, skipped: 0, failed: 0 };

    try {
      /*
       * Over-select by a day and decide per business, exactly as the overdue scan
       * does: `due_date` is a date-only column and the calendar that matters is
       * the one the business keeps, not UTC's.
       */
      const scanBound = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const { data: due, error } = await this.supabase
        .from('payment_plan_installments')
        .select('id, user_id, contact_id, due_date, proposal_id, subscription_id')
        .eq('status', 'pending')
        .eq('trigger', 'date')
        .is('invoice_id', null)
        /*
         * Quote-derived stages, plus plan periods nothing can charge any more.
         *
         * ───────────────────────────────────────────────────────────────────────
         * `proposal_id` separates a quote-derived stage from one projected by
         * `bindPlanSubscription`, and the projected ones were excluded outright
         * because STRIPE collects each period — raising an invoice would bill
         * the client a second time for money already being taken from their
         * card.
         *
         * That reason expires with the subscription. A business that leaves
         * Stripe (commonly to stop paying the percentage) has periods its client
         * still owes and no way left to collect them: the card cannot be
         * charged, and this scan skipped them for ever. They sat `pending` in
         * receivables as income that could never arrive, and closing them would
         * have written off money genuinely owed.
         *
         * So a projected period is included once its plan is provably dead —
         * checked per row below, never assumed from the absence of a reference.
         * ───────────────────────────────────────────────────────────────────────
         */
        .lte('due_date', scanBound)
        .order('due_date', { ascending: true })
        .limit(100);

      if (error) throw error;

      for (const stage of due || []) {
        /*
         * The terms are not consulted here.
         *
         * The invoice's due date is the STAGE's own: the quote promised the money
         * on that day, and adding the terms again at billing time would push
         * every date later than the client agreed to. The terms already decided
         * stage 1, and the cadence stepped from there.
         *
         * So the bill is raised ON the due date rather than ahead of it. An
         * `upcoming_due` reminder for a date that is already here is correctly
         * skipped by `scheduleInvoiceReminders`, and `due_today` still fires.
         */
        /*
         * A period Stripe is still charging must NEVER be invoiced.
         *
         * ───────────────────────────────────────────────────────────────────────
         * This is the guard the old `proposal_id` filter provided bluntly, now
         * asked properly: a projected plan period is billable only when the plan
         * behind it can no longer charge the card. Anything less exact and a
         * client pays twice — once on their card and once on an invoice — which
         * is the worst outcome available here.
         *
         * A quote-derived stage (`proposal_id` set) was always invoiced and is
         * unaffected. Anything else must prove its plan is dead.
         * ───────────────────────────────────────────────────────────────────────
         */
        if (!stage.proposal_id && !(await this.planCanNoLongerCharge(stage))) {
          stats.skipped++;
          continue;
        }

        const today = await this.businessToday(stage.user_id);
        if ((stage.due_date as string) > today) {
          stats.skipped++;
          continue;
        }

        /*
         * Imported here, not at the top of the file.
         *
         * `PaymentStageBillingService` reaches `InvoiceDeliveryService`, which
         * pulls in the PDF renderer — an ES-module package Jest cannot transform.
         * A static import made this whole module unloadable in any test that only
         * wanted a pure helper out of it, and took `proposalSplit.test.ts` down
         * with it. The cost of deferring it is one dynamic import per cron run.
         */
        const { billStage } = await import('@/lib/services/PaymentStageBillingService');

        const result = await billStage(stage.id as string, stage.user_id as string, {
          expectTrigger: 'date',
          dueDate: stage.due_date as string,
          auditAction: 'PAYMENT_PLAN_STAGE_BILLED',
        });

        if (result.failure === 'already_done') {
          stats.skipped++;
          continue;
        }

        if (result.failure || !result.invoiceId) {
          stats.failed++;
          continue;
        }

        stats.billed++;

        /*
         * The reminders the stage could never have. This is the sibling that
         * works: it carries the invoice, so the email it eventually sends has a
         * number on it and a way to pay.
         */
        if (stage.contact_id) {
          await this.scheduleInvoiceReminders(
            stage.user_id as string,
            result.invoiceId,
            stage.contact_id as string,
            stage.due_date as string
          ).catch(err =>
            logger.warn(
              { err, invoiceId: result.invoiceId },
              'Stage billed but its reminders could not be scheduled'
            )
          );
        }
      }

      logger.info(stats, 'Billed the plan stages that came due');
      return stats;
    } catch (error) {
      logger.error({ err: error }, 'Could not bill the stages that came due');
      return stats;
    }
  }
}

// Singleton export
import { supabaseServer } from '@/lib/supabaseServer';
import { recordEmailSend } from '@/lib/notifications/recordEmailSend';
export const paymentReminderService = new PaymentReminderService(supabaseServer);
