/**
 * Chase one late invoice, by hand.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SAME EMAIL THE AGENT SENDS, AND THAT IS THE WHOLE POINT.
 *
 * A late invoice had two different emails depending on who sent it:
 *
 *   chase_overdue_invoices  →  sendInvoiceChase  →  generateChaseInvoiceEmail
 *                              names the amount, the due date, HOW MANY DAYS
 *                              OVERDUE, and a pay link — or a statement when
 *                              several are owed.
 *
 *   every button in the UI  →  /invoices/[id]/send  →  generateInvoiceEmail
 *                              the original invoice, byte for byte.
 *
 * The invoice template has no reminder variant: no `isReminder`, no
 * `daysOverdue`, nothing that knows it is a second send. So a client who
 * ignored the first one received an identical copy that never mentioned it was
 * late — which reads as a system that forgot it had already asked.
 *
 * The agent's version was the considered one. This route exists so a person
 * pressing "send a reminder" sends exactly that, rather than a near-miss with
 * the same name.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS NOT JUST `/send` WITH A FLAG
 *
 * `/send` is invoice DELIVERY: it marks `sent_at`, it is what raises a bill for
 * the first time, and it is reached by paths that have nothing to do with being
 * late. Chasing is a different act with different guards — it refuses a settled
 * invoice, reads how overdue it is, and switches to a statement when the client
 * owes several. Teaching one endpoint both jobs is how they drifted apart in
 * the first place.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { sendInvoiceChase } from '@/lib/services/InsightActionDispatchService';

const logger = createLogger({ module: 'InvoiceChaseAPI' });

const paramsSchema = z.object({ id: z.string().uuid() });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id: invoiceId } = paramsSchema.parse(await params);

    /*
     * `askedByAPerson` bypasses the consent gate and nothing else.
     *
     * That gate asks "may we write to this business's clients" and fails
     * closed, which is right for a queue, a cron or an agent. It is wrong for
     * a button: the owner is looking at the invoice and has just answered that
     * question by pressing. Without this, an owner who never switched on
     * automatic chasing would press a button that silently did nothing — the
     * gate returns `skipped`, not an error.
     *
     * Every other guard still applies. Most importantly the settled check:
     * if the client paid between the press and the send, not sending IS the
     * success.
     */
    const outcome = await sendInvoiceChase(invoiceId, user.id, undefined, {
      askedByAPerson: true,
    });

    if (!outcome.sent) {
      requestLogger.info(
        { userId: user.id, invoiceId, skipped: outcome.skipped, reason: outcome.reason },
        'Invoice chase not sent'
      );
      /*
       * A SKIP IS NOT A FAILURE, and must not be reported as one. "The client
       * already paid" is the guard doing its job, and the owner needs to read
       * it as news rather than as an error to retry.
       */
      /*
       * A CODE, SO THE SCREEN CAN SAY IT IN THE OWNER'S LANGUAGE.
       *
       * `reason` is an English sentence written for a log line — "invoice is
       * paid", "not due until 2026-12-21". Shown verbatim in a red banner to a
       * Hebrew-speaking owner it reads as a system error, when most of these
       * are the guard working and one of them is good news.
       *
       * Classified here, once, rather than by every caller matching on
       * substrings of a message that is free to change.
       */
      const reason = outcome.reason ?? '';
      const code = /^invoice is /.test(reason)
        ? 'already_paid'
        : /not due until/.test(reason)
          ? 'not_due'
          : /no email address/.test(reason)
            ? 'no_email'
            : /not switched on/.test(reason)
              ? 'not_enabled'
              : 'other';

      return NextResponse.json(
        {
          success: false,
          skipped: outcome.skipped ?? false,
          code,
          error: reason || 'The reminder was not sent',
        },
        { status: outcome.skipped ? 409 : 500 }
      );
    }

    requestLogger.info({ userId: user.id, invoiceId }, 'Invoice chase sent');

    return NextResponse.json({ success: true, data: { sent: true } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.flatten() },
        { status: 400 }
      );
    }
    requestLogger.error({ err: error }, 'Invoice chase request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}
