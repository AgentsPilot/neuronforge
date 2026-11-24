/**
 * A first draft of the note a client gets when their refund is declined.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SEPARATE ROUTE FROM `decide`
 *
 * It is asked for BEFORE the decision, not after. The card's decline button
 * confirms in two taps, and this fills the gap between them: the first tap
 * asks for the draft, the owner reads and edits it, and the second tap records
 * the decline and sends what they approved.
 *
 * Drafting here, rather than inside `decide`, is what makes that possible. A
 * draft produced after the decision would have nowhere to be reviewed — a
 * declined request leaves the card the moment it is recorded.
 *
 * It writes nothing. Nothing is decided, nothing is sent, and the request is
 * untouched: a reload after this call leaves the client still waiting, exactly
 * as before. That is why it is safe to call on a first tap somebody may back
 * out of.
 *
 * @module app/api/business-os/refund-requests/decline-draft
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { newBosGroupId } from '@/lib/business-os/llm/callCatalog';
import { runAiAction } from '@/lib/business-os/llm/aiActionAudit';
import { draftRefundDecline } from '@/lib/payments/draftRefundDecline';
import { refundRequestRepository } from '@/lib/repositories/RefundRequestRepository';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'RefundDeclineDraftAPI' });

const draftSchema = z.object({
  requestId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = draftSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'A request id is required' },
        { status: 400 }
      );
    }

    const { requestId } = parsed.data;

    /*
     * The request, read under the owner's own id. The id arrives from the
     * browser, so the scope is what proves it is theirs to answer — never the
     * body (CLAUDE.md § Security Rules).
     */
    const { data: refundRequest, error: readError } = await refundRequestRepository.findById(
      requestId,
      user.id
    );

    if (readError || !refundRequest) {
      requestLogger.info({ userId: user.id, requestId }, 'No such refund request for this owner');
      return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
    }

    /* The two names the message needs, and what they bought. All already the
       owner's own rows, read with the service client after the scope above
       proved ownership. */
    const [{ data: contact }, { data: profile }, { data: booking }] = await Promise.all([
      supabaseServer
        .from('crm_contacts')
        .select('first_name, last_name')
        .eq('id', refundRequest.contact_id)
        .eq('user_id', user.id)
        .maybeSingle(),
      supabaseServer
        .from('business_profiles')
        .select('company_name, invoice_company_name')
        .eq('user_id', user.id)
        .maybeSingle(),
      refundRequest.booking_id
        ? supabaseServer
            .from('scheduling_bookings')
            .select('service:scheduling_services(service_name)')
            .eq('id', refundRequest.booking_id)
            .eq('user_id', user.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const service = (booking as { service?: { service_name?: string } | null } | null)?.service;
    const businessName =
      (profile as { company_name?: string; invoice_company_name?: string } | null)?.company_name ||
      (profile as { invoice_company_name?: string } | null)?.invoice_company_name ||
      'your provider';

    /* One grouping id for this action, minted here and logged where minted, so
       the call can be traced back to the press that caused it. */
    const groupId = newBosGroupId();
    requestLogger.info({ userId: user.id, requestId, groupId }, 'Drafting a refund decline');

    const draft = await runAiAction(
      {
        area: 'payments',
        actionType: 'refund_decline_draft',
        groupId,
        trigger: 'user',
        accountId: user.id,
        correlationId,
      },
      async (h) => {
        const text = await draftRefundDecline(
          {
            businessName,
            clientName:
              (contact as { first_name?: string } | null)?.first_name?.trim() || 'there',
            amountAsked: `${refundRequest.amount_requested} ${refundRequest.currency}`,
            reason: refundRequest.reason ?? null,
            note: refundRequest.note ?? null,
            serviceName: (Array.isArray(service) ? service[0] : service)?.service_name ?? null,
            language: 'the language the client wrote in, or English if that is unclear',
          },
          { userId: user.id, groupId }
        );

        /* Degraded without throwing: the owner still gets to decline, and
           writes the message themselves. */
        if (!text) h.markFailed('generation_failed');

        return text;
      }
    );

    return NextResponse.json({ success: true, data: { draft } });
  } catch (error) {
    requestLogger.error({ errName: (error as Error)?.name }, 'Refund decline draft failed');
    requestLogger.debug({ err: error }, 'Refund decline draft failure detail');
    return NextResponse.json(
      { success: false, error: 'Failed to draft the message' },
      { status: 500 }
    );
  }
}
