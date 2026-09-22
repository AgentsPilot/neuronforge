/**
 * Payment Reminders Cron Job
 *
 * This endpoint is called by Vercel Cron to process payment reminders.
 * It runs daily to:
 * 1. Send scheduled reminders that are due
 * 2. Check for overdue invoices/installments and emit events
 * 3. Schedule overdue reminders based on user config
 *
 * Vercel Cron config (add to vercel.json):
 * {
 *   "crons": [{
 *     "path": "/api/cron/payment-reminders",
 *     "schedule": "0 8 * * *"
 *   }]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { paymentReminderService } from '@/lib/services/PaymentReminderService';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';

// The claim reaper's lease (90s) is set > maxDuration so an overrun function is
// provably dead. Keep maxDuration aligned with the lease constant in the service.
export const runtime = 'nodejs';
export const maxDuration = 60;

const logger = createLogger({ module: 'PaymentRemindersCron' });

// Verify cron secret to ensure only Vercel can call this
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // In development, allow without a secret (local manual triggering).
  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  // Fail CLOSED: in production a missing CRON_SECRET means the request cannot be
  // authenticated, so refuse rather than run the drain unprotected. (This endpoint
  // is a public URL; the bearer secret is the only thing distinguishing a Vercel
  // cron invocation from an arbitrary caller.)
  if (!cronSecret) {
    logger.error('CRON_SECRET not configured - refusing cron request (fail-closed)');
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  // Verify authorization
  if (!verifyCronSecret(request)) {
    requestLogger.warn('Unauthorized cron request');
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const startTime = Date.now();

  try {
    requestLogger.info('Starting payment reminders cron job');

    /*
     * Scan first, send second. The order is the whole schedule.
     *
     * ───────────────────────────────────────────────────────────────────────
     * These ran the other way round, and it cost every overdue reminder a
     * full day.
     *
     * `processOverdueItems` does not send. It finds what is due and writes a
     * reminder row stamped `scheduled_at: now`. `processDueReminders` is the
     * part that sends. With the sender running first, a row created in the
     * scan had already missed its own run and sat until the next one — and
     * this cron runs once a day, at 08:00.
     *
     * So the schedule an owner configures as days 1, 3 and 7 past due was
     * delivering on days 2, 4 and 8. Visible in the data: a reminder stamped
     * 2026-09-16T08:00:12 went out at 2026-09-17T08:00:12, exactly
     * twenty-four hours later.
     *
     * `LeadResponseDispatchService` already had this right and says why:
     * "Enqueue BEFORE claiming, so something that became due this minute goes
     * out on this run rather than the next." Same rule, same reason.
     *
     * Nothing double-sends as a result. `processOverdueItems` skips any
     * invoice already reminded within 24 hours, and the send path claims each
     * row exclusively.
     * ───────────────────────────────────────────────────────────────────────
     */
    const overdueStats = await paymentReminderService.processOverdueItems();

    // Now send everything due, including what the scan just queued.
    const reminderStats = await paymentReminderService.processDueReminders();

    /*
     * Stamp the status, once a day, here.
     *
     * This used to happen on the read path — every dashboard load ran an
     * UPDATE over `payment_invoices` before it could show anything. It is a
     * property of the calendar, not of somebody opening a page, so it belongs
     * on a schedule.
     *
     * AFTER the reminder scan above, not before. The scan now reads 'sent' and
     * 'overdue' both, so the order no longer decides whether a client gets
     * reminded — but running the write second keeps the two independent even
     * if that filter is ever narrowed again.
     *
     * Still last after the scan and send were swapped: this stamps a status
     * column and sends nothing, so it has no bearing on when anyone is
     * reminded.
     */
    const overdueSweep = await paymentInvoiceRepository.markAllOverdueInvoices();
    if (overdueSweep.error) {
      requestLogger.error({ err: overdueSweep.error }, 'Overdue sweep failed (reminders still processed)');
    }

    const duration = Date.now() - startTime;

    requestLogger.info({
      duration,
      reminders: reminderStats,
      overdue: overdueStats,
      invoicesMarkedOverdue: overdueSweep.data ?? 0
    }, 'Payment reminders cron job completed');

    return NextResponse.json({
      success: true,
      data: {
        duration,
        reminders: reminderStats,
        overdue: overdueStats,
        invoicesMarkedOverdue: overdueSweep.data ?? 0
      }
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error({ err: error, duration }, 'Payment reminders cron job failed');

    return NextResponse.json(
      {
        success: false,
        error: 'Cron job failed',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined
      },
      { status: 500 }
    );
  }
}

// Also support POST for manual triggering in development
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { success: false, error: 'POST only allowed in development' },
      { status: 405 }
    );
  }

  return GET(request);
}
