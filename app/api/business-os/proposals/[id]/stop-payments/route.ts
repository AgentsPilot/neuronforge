/**
 * Stop the remaining stages of an accepted quote.
 *
 *   POST /api/business-os/proposals/[id]/stop-payments
 *
 * The client stopped the work after phase one. Two paths already did this where
 * they could reach it — `cancelBooking` by `booking_id`, `cancelPlan` by
 * `subscription_id` — and a milestone quote raised outside a booking has
 * neither, so its stages sat `pending` forever, counted as owed and chased at
 * the client on days 1, 3 and 7. See `cancelQuoteStages` for the full note.
 *
 * The sequence lives in the service, not here: the chat can stop a quote too,
 * and two copies of it would drift. What stays here is what a route owns —
 * authentication, validation, the audit entry, and the shape of the reply.
 *
 * @module app/api/business-os/proposals/[id]/stop-payments
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { cancelQuoteStages } from '@/lib/payments/cancelQuoteStages';
import { STOP_REASONS } from '@/lib/business-os/cancellationReasons';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

const logger = createLogger({ module: 'StopQuotePaymentsAPI' });
const auditTrail = AuditTrailService.getInstance();

const StopSchema = z.object({
  /*
   * From the fixed list, so it can be COUNTED.
   *
   * A free string here would let the same reason arrive as "client stopped",
   * "Client Stopped" and "clint stoped", which is three rows in the analytics
   * this is collected for and one reason in reality. The enum is the whole value
   * of the field; the sentence goes in `note`.
   *
   * REQUIRED. Mandatory on every cancellation surface — the caller is a person
   * who knows the answer. Rejected rather than defaulted: silently storing a
   * placeholder would be worse than the 400, because it would look like data.
   */
  reason: z.enum(STOP_REASONS),
  /** The owner's own sentence. Never a substitute for `reason`. */
  note: z.string().max(1000).optional(),
  /*
   * Whether the note above is emailed to the client. Defaults to TRUE, matching
   * every other cancellation surface; the client always learns the reason either
   * way, in its client-safe phrasing.
   */
  share_note_with_client: z.boolean().optional().default(true),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { id } = await params;

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // An empty body is the ordinary case — a reason is optional — so a missing
    // one must not read as invalid input.
    const parsed = StopSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid request', details: parsed.error.errors },
        { status: 400 }
      );
    }

    const result = await cancelQuoteStages({
      proposalId: id,
      // From the session, never the body: it is what scopes the lookup, so a
      // caller cannot stop somebody else's quote by naming its id.
      userId: user.id,
      reason: parsed.data.reason,
      note: parsed.data.note,
      shareNoteWithClient: parsed.data.share_note_with_client,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.message, code: result.code },
        { status: result.code === 'NOT_FOUND' ? 404 : 500 }
      );
    }

    /*
     * Audited even when nothing changed.
     *
     * Stopping what a client will be asked to pay is a money decision, and
     * "somebody pressed this and it was already done" is worth as much to a
     * later reconciliation as the press that did the work.
     */
    auditTrail
      .log({
        action: 'PROPOSAL_STAGES_CANCELLED',
        userId: user.id,
        entityType: 'proposal',
        entityId: id,
        details: {
          stagesClosed: result.stagesClosed,
          invoicesVoided: result.invoicesVoided,
          proposalStopped: result.proposalStopped ?? false,
          reason: parsed.data.reason,
          note: parsed.data.note?.trim() || null,
        },
        severity: 'warning',
        request,
      })
      .catch((err) => requestLogger.error({ err }, 'Audit failed'));

    return NextResponse.json({
      success: true,
      data: {
        stages_closed: result.stagesClosed,
        invoices_voided: result.invoicesVoided,
        proposal_stopped: result.proposalStopped ?? false,
        already_closed: result.alreadyClosed ?? false,
        /* What is still held, so the caller can offer the standard refund dialog. */
        collected: result.collected,
        currency: result.currency,
      },
    });
  } catch (err) {
    requestLogger.error({ err, proposalId: id }, 'Could not stop the quote stages');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not stop the remaining payments on this quote.',
        details: process.env.NODE_ENV === 'development' ? String(err) : undefined,
      },
      { status: 500 }
    );
  }
}
