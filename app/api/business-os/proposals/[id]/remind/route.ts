/**
 * Follow up on a quote the client has not answered.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The same reminder `chase_quotes` sends on its own, sent now because the
 * owner pressed the button on the Needs You card. One send function for both,
 * so a quote cannot be followed up in two different voices — and so the thing
 * the owner triggers is exactly the thing they were offered.
 *
 * NOT the same as `../send`. That re-issues the quote: the document, every
 * stage, the terms, a `proposal_sent` activity. This points at the page the
 * client already has and asks whether they need more time or anything
 * explained. Sending the quote twice leaves a client holding two documents
 * with one question nobody wanted.
 *
 * What stays here is what a route owns: authentication, the audit entry, and
 * the shape of the reply.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { sendQuoteReminder } from '@/lib/services/ProposalSendService';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

const logger = createLogger({ module: 'ProposalRemindAPI' });
const auditTrail = AuditTrailService.getInstance();

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

    const outcome = await sendQuoteReminder(id, user.id);

    if (!outcome.ok) {
      /*
       * Three different things, and the card says different words for each.
       *
       * `already_answered` is not a failure — the client accepted or declined
       * while the row sat on the dashboard, which is the outcome everybody
       * wanted. Reporting it as an error would have the owner chasing a
       * problem that is actually good news.
       */
      if (outcome.reason === 'not_found') {
        return NextResponse.json({ success: false, error: 'Quote not found' }, { status: 404 });
      }
      if (outcome.reason === 'already_answered') {
        return NextResponse.json(
          { success: false, error: 'That quote has already been answered', code: 'already_answered' },
          { status: 409 }
        );
      }
      if (outcome.reason === 'no_email') {
        return NextResponse.json(
          { success: false, error: 'That client has no email address', code: 'no_client_email' },
          { status: 400 }
        );
      }

      requestLogger.error({ reason: outcome.reason, proposalId: id }, 'Quote reminder failed');
      return NextResponse.json(
        { success: false, error: 'Could not send the reminder' },
        { status: 500 }
      );
    }

    auditTrail
      .log({
        action: 'PROPOSAL_REMINDER_SENT',
        userId: user.id,
        entityType: 'proposal',
        entityId: id,
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    return NextResponse.json({ success: true, data: { sent: true } });
  } catch (error) {
    requestLogger.error({ err: error, proposalId: id }, 'Quote reminder threw');
    return NextResponse.json(
      { success: false, error: 'Could not send the reminder' },
      { status: 500 }
    );
  }
}
